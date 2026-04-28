const mongoose = require('mongoose');

const transferSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, required: true },
    from: { type: String, required: true },
    to: { type: String, required: true },
    qty: { type: Number, required: true, min: 1 },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transfer', transferSchema);
