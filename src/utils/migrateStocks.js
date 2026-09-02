/**
 * One-off migration: give every inventory item a per-warehouse `stocks`
 * breakdown derived from its legacy single `warehouse` + `stock` fields.
 *
 * Safe to re-run — items that already have a breakdown are skipped.
 *
 *   npm run migrate:stocks
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const InventoryItem = require('../models/InventoryItem');

(async () => {
  try {
    await connectDB();
    const items = await InventoryItem.find({
      $or: [{ stocks: { $exists: false } }, { stocks: { $size: 0 } }],
    });
    let migrated = 0;
    let skipped = 0;
    for (const item of items) {
      if (!item.warehouse || !(item.stock > 0)) {
        skipped += 1;
        continue;
      }
      item.ensureStocks();
      item.syncFromStocks();
      await item.save();
      migrated += 1;
      console.log(`  ${item.name}: ${item.stock} → ${item.warehouseName}`);
    }
    console.log(`Migration complete. ${migrated} item(s) migrated, ${skipped} skipped (no warehouse or zero stock).`);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
