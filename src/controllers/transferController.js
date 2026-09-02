const asyncHandler = require('express-async-handler');
const Transfer = require('../models/Transfer');
const InventoryItem = require('../models/InventoryItem');
const Warehouse = require('../models/Warehouse');
const { recordAudit } = require('../middleware/audit');
const { assertCapacity } = require('../services/capacityService');

// GET /api/transfers
const listTransfers = asyncHandler(async (_req, res) => {
  const transfers = await Transfer.find().sort({ date: -1 });
  res.json(transfers);
});

// POST /api/transfers
// Moves `qty` of an item from one warehouse to another. Only the requested
// quantity moves; the remainder stays in the source warehouse.
const createTransfer = asyncHandler(async (req, res) => {
  const { item, from, to, date } = req.body;
  const qty = Number(req.body.qty);
  if (!item || !from || !to || !req.body.qty) {
    res.status(400);
    throw new Error('item, from, to, and qty are required');
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    res.status(400);
    throw new Error('qty must be a whole number greater than 0');
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
  itemDoc.ensureStocks();

  const fromWh = await Warehouse.findOne({ name: from });
  const toWh = await Warehouse.findOne({ name: to });
  if (!fromWh || !toWh) {
    res.status(404);
    throw new Error('Source or destination warehouse not found');
  }

  const source = itemDoc.stocks.find((entry) => String(entry.warehouse) === String(fromWh._id));
  const available = source ? Number(source.qty) : 0;
  if (available < qty) {
    res.status(400);
    throw new Error(
      `Insufficient stock in ${fromWh.name}: ${available} ${itemDoc.unit || 'units'} available, ${qty} requested`
    );
  }

  source.qty = available - qty;
  const destination = itemDoc.stocks.find((entry) => String(entry.warehouse) === String(toWh._id));
  if (destination) {
    destination.qty = Number(destination.qty) + qty;
  } else {
    itemDoc.stocks.push({ warehouse: toWh._id, warehouseName: toWh.name, qty });
  }
  itemDoc.syncFromStocks();
  await assertCapacity(itemDoc, res);
  await itemDoc.save();

  const transfer = await Transfer.create({
    item: itemDoc._id,
    itemName: itemDoc.name,
    from: fromWh.name,
    to: toWh.name,
    qty,
    date: date || new Date(),
  });

  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Inventory',
    details: `Transferred ${qty} ${itemDoc.name} from ${fromWh.name} to ${toWh.name}`,
  });

  res.status(201).json({ ...transfer.toJSON(), updatedItem: itemDoc.toJSON() });
});

module.exports = { listTransfers, createTransfer };
