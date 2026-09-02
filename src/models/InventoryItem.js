const mongoose = require('mongoose');

// Per-warehouse stock entry. An item can live in several warehouses at once;
// `stock` on the item is always the sum of these entries.
const stockEntrySchema = new mongoose.Schema(
  {
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    warehouseName: { type: String, required: true },
    qty: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false }
);

const inventoryItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    unit: { type: String, default: 'piece', trim: true },
    // Category name from Settings -> inventory.categories. Items created before
    // categories existed fall back to 'Others'.
    category: { type: String, default: 'Others', trim: true },
    price: { type: Number, required: true, min: 0 },
    // Total stock across all warehouses (derived from `stocks`).
    stock: { type: Number, required: true, min: 0, default: 0 },
    // Per-warehouse breakdown. Source of truth for where stock physically is.
    stocks: { type: [stockEntrySchema], default: [] },
    // Primary warehouse (the one holding the most stock) — kept for backwards
    // compatibility with older clients / reports that read a single warehouse.
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
    warehouseName: { type: String },
    lowStockThreshold: { type: Number, default: 10, min: 0 },
  },
  { timestamps: true }
);

/**
 * Legacy documents (created before per-warehouse stock existed) have an empty
 * `stocks` array but a `warehouse` + `stock`. Normalise them in memory so every
 * caller can rely on `stocks`.
 */
inventoryItemSchema.methods.ensureStocks = function ensureStocks() {
  if ((!this.stocks || this.stocks.length === 0) && this.warehouse && this.stock > 0) {
    this.stocks = [
      { warehouse: this.warehouse, warehouseName: this.warehouseName || '', qty: this.stock },
    ];
  }
  return this;
};

/**
 * Recompute derived fields (`stock`, `warehouse`, `warehouseName`) from `stocks`.
 * Drops empty entries so warehouses only count items they actually hold.
 */
inventoryItemSchema.methods.syncFromStocks = function syncFromStocks() {
  const entries = (this.stocks || []).filter((entry) => Number(entry.qty) > 0);
  this.stocks = entries;
  this.stock = entries.reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
  if (entries.length > 0) {
    const primary = entries.reduce((best, entry) => (entry.qty > best.qty ? entry : best), entries[0]);
    this.warehouse = primary.warehouse;
    this.warehouseName = primary.warehouseName;
  }
  return this;
};

inventoryItemSchema.pre('save', function (next) {
  if (this.stocks && this.stocks.length > 0) {
    this.syncFromStocks();
  }
  next();
});

inventoryItemSchema.virtual('status').get(function () {
  if (this.stock <= 0) return 'Out of Stock';
  if (this.stock <= this.lowStockThreshold) return 'Low Stock';
  return 'In Stock';
});

inventoryItemSchema.virtual('statusTone').get(function () {
  if (this.stock <= 0) return 'danger';
  if (this.stock <= this.lowStockThreshold) return 'danger';
  return 'success';
});

// Expose a normalised `stocks` array even for legacy documents.
function exposeStocks(_doc, ret) {
  if ((!ret.stocks || ret.stocks.length === 0) && ret.warehouse && ret.stock > 0) {
    ret.stocks = [{ warehouse: ret.warehouse, warehouseName: ret.warehouseName || '', qty: ret.stock }];
  }
  return ret;
}

inventoryItemSchema.set('toJSON', { virtuals: true, transform: exposeStocks });
inventoryItemSchema.set('toObject', { virtuals: true, transform: exposeStocks });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
