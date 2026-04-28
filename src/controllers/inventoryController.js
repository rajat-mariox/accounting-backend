const asyncHandler = require('express-async-handler');
const InventoryItem = require('../models/InventoryItem');
const Warehouse = require('../models/Warehouse');
const { recordAudit } = require('../middleware/audit');

// GET /api/inventory
const listItems = asyncHandler(async (_req, res) => {
  const items = await InventoryItem.find().sort({ createdAt: -1 });
  res.json(items);
});

// GET /api/inventory/overview
const stockOverview = asyncHandler(async (_req, res) => {
  const items = await InventoryItem.find().lean();
  let inStock = 0;
  let low = 0;
  let out = 0;
  for (const item of items) {
    if (item.stock <= 0) out += 1;
    else if (item.stock <= (item.lowStockThreshold ?? 10)) low += 1;
    else inStock += 1;
  }
  res.json([
    { id: 'in-stock', label: 'In Stock', value: inStock },
    { id: 'low-stock', label: 'Low Stock', value: low },
    { id: 'out-of-stock', label: 'Out of Stock', value: out },
  ]);
});

// GET /api/inventory/:id
const getItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Item not found');
  }
  res.json(item);
});

// POST /api/inventory
const createItem = asyncHandler(async (req, res) => {
  const { name, unit, price, stock, warehouse, lowStockThreshold } = req.body;
  if (!name || price === undefined) {
    res.status(400);
    throw new Error('Name and price are required');
  }
  let warehouseDoc = null;
  if (warehouse) {
    warehouseDoc = await Warehouse.findById(warehouse);
    if (!warehouseDoc) {
      res.status(404);
      throw new Error('Warehouse not found');
    }
  }
  const item = await InventoryItem.create({
    name,
    unit: unit || 'piece',
    price,
    stock: stock || 0,
    warehouse: warehouseDoc?._id,
    warehouseName: warehouseDoc?.name,
    lowStockThreshold: lowStockThreshold ?? 10,
  });
  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Inventory',
    details: `Created item: ${item.name}`,
  });
  res.status(201).json(item);
});

// PUT /api/inventory/:id
const updateItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Item not found');
  }
  const { name, unit, price, stock, warehouse, lowStockThreshold } = req.body;
  if (name !== undefined) item.name = name;
  if (unit !== undefined) item.unit = unit;
  if (price !== undefined) item.price = price;
  if (stock !== undefined) item.stock = stock;
  if (lowStockThreshold !== undefined) item.lowStockThreshold = lowStockThreshold;
  if (warehouse !== undefined) {
    if (warehouse) {
      const wh = await Warehouse.findById(warehouse);
      if (!wh) {
        res.status(404);
        throw new Error('Warehouse not found');
      }
      item.warehouse = wh._id;
      item.warehouseName = wh.name;
    } else {
      item.warehouse = undefined;
      item.warehouseName = undefined;
    }
  }
  await item.save();
  await recordAudit({
    user: req.user,
    action: 'Update',
    module: 'Inventory',
    details: `Updated item: ${item.name}`,
  });
  res.json(item);
});

// DELETE /api/inventory/:id
const deleteItem = asyncHandler(async (req, res) => {
  const item = await InventoryItem.findById(req.params.id);
  if (!item) {
    res.status(404);
    throw new Error('Item not found');
  }
  await item.deleteOne();
  await recordAudit({
    user: req.user,
    action: 'Delete',
    module: 'Inventory',
    details: `Deleted item: ${item.name}`,
  });
  res.json({ message: 'Item deleted' });
});

module.exports = { listItems, stockOverview, getItem, createItem, updateItem, deleteItem };
