const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Transfer = require('../models/Transfer');
const InventoryItem = require('../models/InventoryItem');
const Warehouse = require('../models/Warehouse');
const { recordAudit } = require('../middleware/audit');

// GET /api/transfers
const listTransfers = asyncHandler(async (_req, res) => {
  const transfers = await Transfer.find().sort({ date: -1 });
  res.json(transfers);
});

// POST /api/transfers
const createTransfer = asyncHandler(async (req, res) => {
  const { item, from, to, qty, date } = req.body;
  if (!item || !from || !to || !qty) {
    res.status(400);
    throw new Error('item, from, to, and qty are required');
  }
  if (from === to) {
    res.status(400);
    throw new Error('Source and destination warehouses must differ');
  }

  const itemDoc = await InventoryItem.findById(item);
  if (!itemDoc) {
    res.status(404);
    throw new Error('Item not found');
  }
  if (itemDoc.stock < qty) {
    res.status(400);
    throw new Error('Insufficient stock for transfer');
  }

  const fromWh = await Warehouse.findOne({ name: from });
  const toWh = await Warehouse.findOne({ name: to });
  if (!fromWh || !toWh) {
    res.status(404);
    throw new Error('Source or destination warehouse not found');
  }

  // simple stock adjustment on the item; not multi-warehouse-per-item
  itemDoc.stock = itemDoc.stock - Number(qty) + Number(qty); // net zero — placeholder if you later split per-warehouse
  itemDoc.warehouse = toWh._id;
  itemDoc.warehouseName = toWh.name;
  await itemDoc.save();

  const transfer = await Transfer.create({
    item: itemDoc._id,
    itemName: itemDoc.name,
    from,
    to,
    qty,
    date: date || new Date(),
  });

  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Inventory',
    details: `Transferred ${qty} ${itemDoc.name} from ${from} to ${to}`,
  });

  res.status(201).json(transfer);
});

module.exports = { listTransfers, createTransfer };
