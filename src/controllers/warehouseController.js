const asyncHandler = require('express-async-handler');
const Warehouse = require('../models/Warehouse');
const InventoryItem = require('../models/InventoryItem');
const { recordAudit } = require('../middleware/audit');

// GET /api/warehouses
const listWarehouses = asyncHandler(async (_req, res) => {
  const warehouses = await Warehouse.find().sort({ name: 1 }).lean();
  const agg = await InventoryItem.aggregate([
    { $match: { warehouse: { $ne: null } } },
    {
      $group: {
        _id: '$warehouse',
        totalItems: { $sum: 1 },
        totalStock: { $sum: '$stock' },
      },
    },
  ]);
  const map = new Map(agg.map((a) => [String(a._id), a]));
  const enriched = warehouses.map((w) => {
    const a = map.get(String(w._id));
    return { ...w, totalItems: a?.totalItems || 0, totalStock: a?.totalStock || 0 };
  });
  res.json(enriched);
});

// POST /api/warehouses
const createWarehouse = asyncHandler(async (req, res) => {
  const { name, location, capacity } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Name is required');
  }
  const warehouse = await Warehouse.create({ name, location, capacity: capacity || 0 });
  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Inventory',
    details: `Created warehouse: ${warehouse.name}`,
  });
  res.status(201).json(warehouse);
});

// PUT /api/warehouses/:id
const updateWarehouse = asyncHandler(async (req, res) => {
  const warehouse = await Warehouse.findById(req.params.id);
  if (!warehouse) {
    res.status(404);
    throw new Error('Warehouse not found');
  }
  ['name', 'location', 'capacity'].forEach((field) => {
    if (req.body[field] !== undefined) warehouse[field] = req.body[field];
  });
  await warehouse.save();
  // keep denormalized name on inventory items in sync
  await InventoryItem.updateMany(
    { warehouse: warehouse._id },
    { $set: { warehouseName: warehouse.name } }
  );
  await recordAudit({
    user: req.user,
    action: 'Update',
    module: 'Inventory',
    details: `Updated warehouse: ${warehouse.name}`,
  });
  res.json(warehouse);
});

// DELETE /api/warehouses/:id
const deleteWarehouse = asyncHandler(async (req, res) => {
  const warehouse = await Warehouse.findById(req.params.id);
  if (!warehouse) {
    res.status(404);
    throw new Error('Warehouse not found');
  }
  const itemCount = await InventoryItem.countDocuments({ warehouse: warehouse._id });
  if (itemCount > 0) {
    res.status(400);
    throw new Error(`Cannot delete: ${itemCount} item(s) still reference this warehouse`);
  }
  await warehouse.deleteOne();
  await recordAudit({
    user: req.user,
    action: 'Delete',
    module: 'Inventory',
    details: `Deleted warehouse: ${warehouse.name}`,
  });
  res.json({ message: 'Warehouse deleted' });
});

module.exports = { listWarehouses, createWarehouse, updateWarehouse, deleteWarehouse };
