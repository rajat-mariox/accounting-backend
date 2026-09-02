const asyncHandler = require('express-async-handler');
const InventoryItem = require('../models/InventoryItem');
const Warehouse = require('../models/Warehouse');
const { recordAudit } = require('../middleware/audit');
const { getInventoryCategories, DEFAULT_CATEGORY } = require('./settingsController');
const { assertCapacity } = require('../services/capacityService');

/**
 * Resolve and validate a `stocks` payload: [{ warehouse: <id>, qty }].
 * Returns entries with warehouseName filled in.
 */
async function resolveStocks(stocks, res) {
  if (!Array.isArray(stocks)) {
    res.status(400);
    throw new Error('stocks must be an array of { warehouse, qty }');
  }
  const merged = new Map();
  for (const entry of stocks) {
    if (!entry || !entry.warehouse) continue;
    const qty = Number(entry.qty);
    if (!Number.isInteger(qty) || qty < 0) {
      res.status(400);
      throw new Error('Each stock qty must be a whole number of 0 or more');
    }
    merged.set(String(entry.warehouse), (merged.get(String(entry.warehouse)) || 0) + qty);
  }
  const ids = [...merged.keys()];
  const warehouses = await Warehouse.find({ _id: { $in: ids } }).lean();
  if (warehouses.length !== ids.length) {
    res.status(404);
    throw new Error('One or more warehouses not found');
  }
  return warehouses.map((wh) => ({
    warehouse: wh._id,
    warehouseName: wh.name,
    qty: merged.get(String(wh._id)),
  }));
}

/**
 * Apply a single-warehouse stock update to an item:
 *  - if the item has 0-1 locations, the whole stock lives in `warehouseDoc` (or the existing one)
 *  - if it has several locations and a warehouse is given, set that location's qty
 *  - if it has several locations and no warehouse is given, apply the difference to the primary location
 */
function applyStock(item, stock, warehouseDoc) {
  item.ensureStocks();
  const qty = Number(stock);
  const entries = item.stocks;
  const findEntry = (id) => entries.find((e) => String(e.warehouse) === String(id));

  if (entries.length === 0 && !warehouseDoc) {
    // no warehouse at all — keep a bare total
    item.stocks = [];
    item.stock = qty;
    return;
  }
  if (entries.length <= 1) {
    const target = warehouseDoc
      ? { warehouse: warehouseDoc._id, warehouseName: warehouseDoc.name }
      : { warehouse: entries[0].warehouse, warehouseName: entries[0].warehouseName };
    item.stocks = [{ ...target, qty }];
  } else if (warehouseDoc) {
    const entry = findEntry(warehouseDoc._id);
    if (entry) entry.qty = qty;
    else entries.push({ warehouse: warehouseDoc._id, warehouseName: warehouseDoc.name, qty });
  } else {
    const delta = qty - item.stock;
    const primary = findEntry(item.warehouse) || entries[0];
    primary.qty = Math.max(0, Number(primary.qty) + delta);
  }
  item.syncFromStocks();
}

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

// GET /api/inventory/distribution
// Stock split by category (for the Inventory report pie) plus headline totals.
const stockDistribution = asyncHandler(async (_req, res) => {
  const items = await InventoryItem.find().lean();
  const byCategory = new Map();
  let totalUnits = 0;
  let lowStockItems = 0;
  for (const item of items) {
    const category = item.category || DEFAULT_CATEGORY;
    const units = Number(item.stock) || 0;
    const entry = byCategory.get(category) || { label: category, items: 0, units: 0 };
    entry.items += 1;
    entry.units += units;
    byCategory.set(category, entry);
    totalUnits += units;
    if (units > 0 && units <= (item.lowStockThreshold ?? 10)) lowStockItems += 1;
  }
  const categories = [...byCategory.values()]
    .map((entry) => ({
      ...entry,
      // Share of total stock units; falls back to item share when nothing is in stock.
      percent: totalUnits > 0
        ? Math.round((entry.units / totalUnits) * 1000) / 10
        : items.length > 0
          ? Math.round((entry.items / items.length) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.units - a.units || b.items - a.items);
  res.json({ categories, totalItems: items.length, totalUnits, lowStockItems });
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

// Validate a category against Settings -> inventory.categories (case-insensitive),
// returning the canonical spelling. Empty input falls back to the default category.
async function resolveCategory(input, res) {
  const name = String(input ?? '').trim();
  if (!name) return DEFAULT_CATEGORY;
  const categories = await getInventoryCategories();
  const match = categories.find((c) => c.toLowerCase() === name.toLowerCase());
  if (!match) {
    res.status(400);
    throw new Error(`Unknown category "${name}". Add it under Settings -> Inventory Categories first.`);
  }
  return match;
}

// POST /api/inventory
const createItem = asyncHandler(async (req, res) => {
  const { name, unit, price, stock, stocks, warehouse, lowStockThreshold, category } = req.body;
  if (!name || price === undefined) {
    res.status(400);
    throw new Error('Name and price are required');
  }
  const item = new InventoryItem({
    name,
    unit: unit || 'piece',
    category: await resolveCategory(category, res),
    price,
    stock: 0,
    lowStockThreshold: lowStockThreshold ?? 10,
  });
  if (stocks !== undefined) {
    item.stocks = await resolveStocks(stocks, res);
    item.syncFromStocks();
  } else {
    let warehouseDoc = null;
    if (warehouse) {
      warehouseDoc = await Warehouse.findById(warehouse);
      if (!warehouseDoc) {
        res.status(404);
        throw new Error('Warehouse not found');
      }
    }
    applyStock(item, stock || 0, warehouseDoc);
  }
  await assertCapacity(item, res);
  await item.save();
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
  const { name, unit, price, stock, stocks, warehouse, lowStockThreshold, category } = req.body;
  if (name !== undefined) item.name = name;
  if (unit !== undefined) item.unit = unit;
  if (category !== undefined) item.category = await resolveCategory(category, res);
  if (price !== undefined) item.price = price;
  if (lowStockThreshold !== undefined) item.lowStockThreshold = lowStockThreshold;

  if (stocks !== undefined) {
    // Full per-warehouse breakdown supplied — replace it.
    item.stocks = await resolveStocks(stocks, res);
    item.syncFromStocks();
  } else {
    let warehouseDoc = null;
    if (warehouse) {
      warehouseDoc = await Warehouse.findById(warehouse);
      if (!warehouseDoc) {
        res.status(404);
        throw new Error('Warehouse not found');
      }
    }
    if (stock !== undefined) {
      applyStock(item, stock, warehouseDoc);
    } else if (warehouseDoc) {
      // Warehouse changed without a stock figure: relocate the whole item there.
      item.ensureStocks();
      item.stocks = [{ warehouse: warehouseDoc._id, warehouseName: warehouseDoc.name, qty: item.stock }];
      item.syncFromStocks();
    }
  }
  await assertCapacity(item, res);
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

module.exports = { listItems, stockOverview, stockDistribution, getItem, createItem, updateItem, deleteItem };
