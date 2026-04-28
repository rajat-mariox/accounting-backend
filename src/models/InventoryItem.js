const mongoose = require('mongoose');

const inventoryItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    unit: { type: String, default: 'piece', trim: true },
    price: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    warehouse: { type: mongoose.Schema.Types.ObjectId, ref: 'Warehouse' },
    warehouseName: { type: String },
    lowStockThreshold: { type: Number, default: 10, min: 0 },
  },
  { timestamps: true }
);

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

inventoryItemSchema.set('toJSON', { virtuals: true });
inventoryItemSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('InventoryItem', inventoryItemSchema);
