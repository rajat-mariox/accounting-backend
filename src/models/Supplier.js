const mongoose = require('mongoose');

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    company: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    address: { type: String, trim: true },
  },
  { timestamps: true }
);

const supplyActivitySchema = new mongoose.Schema(
  {
    date: { type: Date, default: Date.now },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', required: true },
    supplierName: { type: String },
    item: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    pricePerUnit: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

module.exports = {
  Supplier: mongoose.model('Supplier', supplierSchema),
  SupplyActivity: mongoose.model('SupplyActivity', supplyActivitySchema),
};
