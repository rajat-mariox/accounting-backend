const mongoose = require('mongoose');

const warehouseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    location: { type: String, trim: true },
    capacity: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Warehouse', warehouseSchema);
