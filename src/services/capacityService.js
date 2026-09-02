const InventoryItem = require('../models/InventoryItem');
const Warehouse = require('../models/Warehouse');

/**
 * Units currently stored per warehouse, derived from each item's per-warehouse
 * breakdown (legacy items fall back to their single warehouse + stock).
 *
 * @param {object} [opts]
 * @param {string|ObjectId} [opts.excludeItemId] leave this item out (used when re-checking it)
 * @returns {Promise<Map<string, { totalItems: number, totalStock: number }>>}
 */
async function warehouseUsage({ excludeItemId } = {}) {
  const pipeline = [];
  if (excludeItemId) pipeline.push({ $match: { _id: { $ne: excludeItemId } } });
  pipeline.push(
    {
      $project: {
        entries: {
          $cond: [
            { $gt: [{ $size: { $ifNull: ['$stocks', []] } }, 0] },
            '$stocks',
            [{ warehouse: '$warehouse', qty: '$stock' }],
          ],
        },
      },
    },
    { $unwind: '$entries' },
    { $match: { 'entries.warehouse': { $ne: null }, 'entries.qty': { $gt: 0 } } },
    {
      $group: {
        _id: '$entries.warehouse',
        totalItems: { $sum: 1 },
        totalStock: { $sum: '$entries.qty' },
      },
    }
  );
  const rows = await InventoryItem.aggregate(pipeline);
  return new Map(rows.map((row) => [String(row._id), { totalItems: row.totalItems, totalStock: row.totalStock }]));
}

/**
 * Throw (400) if saving `item` with its current in-memory `stocks` would push any
 * warehouse over its capacity. A capacity of 0 / unset means unlimited.
 */
async function assertCapacity(item, res) {
  const entries = (item.stocks || []).filter((entry) => Number(entry.qty) > 0);
  if (entries.length === 0) return;

  // Only warehouses where this item's quantity *increases* are checked, so an
  // already-over-capacity warehouse can still be drained by transfers/stock-out.
  const previous = item.isNew ? null : await InventoryItem.findById(item._id).lean();
  const previousQty = (warehouseId) => {
    if (!previous) return 0;
    const prevEntries = previous.stocks && previous.stocks.length > 0
      ? previous.stocks
      : previous.warehouse ? [{ warehouse: previous.warehouse, qty: previous.stock }] : [];
    const match = prevEntries.find((e) => String(e.warehouse) === String(warehouseId));
    return match ? Number(match.qty) : 0;
  };

  const usage = await warehouseUsage({ excludeItemId: item._id });
  const ids = entries.map((entry) => entry.warehouse);
  const warehouses = await Warehouse.find({ _id: { $in: ids } }).lean();
  const byId = new Map(warehouses.map((wh) => [String(wh._id), wh]));

  for (const entry of entries) {
    const wh = byId.get(String(entry.warehouse));
    if (!wh || !(wh.capacity > 0)) continue;
    if (Number(entry.qty) <= previousQty(wh._id)) continue;
    const used = usage.get(String(wh._id))?.totalStock || 0;
    const next = used + Number(entry.qty);
    if (next > wh.capacity) {
      const canAdd = Math.max(0, wh.capacity - used - previousQty(wh._id));
      res.status(400);
      throw new Error(
        `${wh.name} is over capacity: ${next} units would be stored but capacity is ${wh.capacity} ` +
          `(only ${canAdd} more can be added).`
      );
    }
  }
}

module.exports = { warehouseUsage, assertCapacity };
