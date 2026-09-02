const InventoryItem = require('../models/InventoryItem');

// Resolve invoice line items to inventory documents (by id, falling back to name).
async function resolveLines(lines) {
  const out = [];
  for (const line of lines) {
    let doc = null;
    if (line.item) doc = await InventoryItem.findById(line.item);
    if (!doc && line.name) doc = await InventoryItem.findOne({ name: line.name });
    out.push({ line, doc });
  }
  return out;
}

// Merge quantities per inventory item so the same product on two lines is checked once.
function mergeByItem(resolved) {
  const map = new Map();
  for (const { line, doc } of resolved) {
    if (!doc) continue;
    const key = String(doc._id);
    const entry = map.get(key) || { doc, qty: 0, name: line.name };
    entry.qty += Number(line.quantity) || 0;
    map.set(key, entry);
  }
  return [...map.values()];
}

/**
 * Throw 400 if any line asks for more than the item currently has in stock.
 */
async function assertStockAvailable(lines, res) {
  const resolved = await resolveLines(lines);
  const missing = resolved.filter((r) => !r.doc);
  if (missing.length > 0) {
    res.status(400);
    throw new Error(`Inventory item not found: ${missing.map((r) => r.line.name).join(', ')}`);
  }
  const short = mergeByItem(resolved).filter(({ doc, qty }) => Number(doc.stock) < qty);
  if (short.length > 0) {
    res.status(400);
    throw new Error(
      'Insufficient stock: ' +
        short.map(({ doc, qty }) => `${doc.name} (requested ${qty}, available ${doc.stock})`).join('; ')
    );
  }
  return resolved;
}

// Subtract qty from an item's per-warehouse breakdown, draining the largest location first.
function takeFromItem(doc, qty) {
  doc.ensureStocks();
  let remaining = qty;
  if (!doc.stocks || doc.stocks.length === 0) {
    doc.stock = Math.max(0, Number(doc.stock) - qty);
    return;
  }
  const entries = [...doc.stocks].sort((a, b) => Number(b.qty) - Number(a.qty));
  for (const entry of entries) {
    if (remaining <= 0) break;
    const take = Math.min(Number(entry.qty), remaining);
    entry.qty = Number(entry.qty) - take;
    remaining -= take;
  }
  doc.stocks = entries;
  doc.syncFromStocks();
}

// Put qty back on an item (into its primary warehouse, or a bare total).
function returnToItem(doc, qty) {
  doc.ensureStocks();
  if (!doc.stocks || doc.stocks.length === 0) {
    if (doc.warehouse) {
      doc.stocks = [{ warehouse: doc.warehouse, warehouseName: doc.warehouseName || '', qty }];
      doc.syncFromStocks();
    } else {
      doc.stock = Number(doc.stock) + qty;
    }
    return;
  }
  const primary = doc.stocks.find((e) => String(e.warehouse) === String(doc.warehouse)) || doc.stocks[0];
  primary.qty = Number(primary.qty) + qty;
  doc.syncFromStocks();
}

/**
 * Deduct the invoice's quantities from inventory. Call after assertStockAvailable.
 * Returns the updated inventory items.
 */
async function deductStock(lines, res) {
  const resolved = await assertStockAvailable(lines, res);
  const updated = [];
  for (const { doc, qty } of mergeByItem(resolved)) {
    takeFromItem(doc, qty);
    await doc.save();
    updated.push(doc);
  }
  return updated;
}

/**
 * Return the invoice's quantities to inventory (delete / cancel).
 */
async function restoreStock(lines) {
  const resolved = await resolveLines(lines);
  const updated = [];
  for (const { doc, qty } of mergeByItem(resolved)) {
    returnToItem(doc, qty);
    await doc.save();
    updated.push(doc);
  }
  return updated;
}

module.exports = { assertStockAvailable, deductStock, restoreStock };
