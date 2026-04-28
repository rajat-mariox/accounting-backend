const asyncHandler = require('express-async-handler');
const { Supplier, SupplyActivity } = require('../models/Supplier');
const { recordAudit } = require('../middleware/audit');

// GET /api/suppliers
const listSuppliers = asyncHandler(async (req, res) => {
  const suppliers = await Supplier.find().sort({ createdAt: -1 }).lean();
  const activityAgg = await SupplyActivity.aggregate([
    {
      $group: {
        _id: '$supplier',
        activities: { $sum: 1 },
        total: { $sum: '$totalAmount' },
      },
    },
  ]);
  const map = new Map(activityAgg.map((a) => [String(a._id), a]));
  const enriched = suppliers.map((s) => {
    const a = map.get(String(s._id));
    return { ...s, activities: a?.activities || 0, total: a?.total || 0 };
  });
  res.json(enriched);
});

// GET /api/suppliers/:id
const getSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  const activities = await SupplyActivity.find({ supplier: supplier._id }).sort({ date: -1 });
  res.json({ ...supplier.toObject(), activities });
});

// POST /api/suppliers
const createSupplier = asyncHandler(async (req, res) => {
  const { name, company, email, phone, address } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Name is required');
  }
  const supplier = await Supplier.create({ name, company, email, phone, address });
  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Suppliers',
    details: `Added supplier: ${supplier.name}`,
  });
  res.status(201).json(supplier);
});

// PUT /api/suppliers/:id
const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  ['name', 'company', 'email', 'phone', 'address'].forEach((field) => {
    if (req.body[field] !== undefined) supplier[field] = req.body[field];
  });
  await supplier.save();
  await recordAudit({
    user: req.user,
    action: 'Update',
    module: 'Suppliers',
    details: `Updated supplier: ${supplier.name}`,
  });
  res.json(supplier);
});

// DELETE /api/suppliers/:id
const deleteSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.findById(req.params.id);
  if (!supplier) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  await supplier.deleteOne();
  await recordAudit({
    user: req.user,
    action: 'Delete',
    module: 'Suppliers',
    details: `Deleted supplier: ${supplier.name}`,
  });
  res.json({ message: 'Supplier deleted' });
});

// GET /api/suppliers/activities/all
const listActivities = asyncHandler(async (_req, res) => {
  const activities = await SupplyActivity.find().sort({ date: -1 });
  res.json(activities);
});

// POST /api/suppliers/activities
const createActivity = asyncHandler(async (req, res) => {
  const { supplier, item, quantity, pricePerUnit, date } = req.body;
  if (!supplier || !item || !quantity || pricePerUnit === undefined) {
    res.status(400);
    throw new Error('supplier, item, quantity, and pricePerUnit are required');
  }
  const supplierDoc = await Supplier.findById(supplier);
  if (!supplierDoc) {
    res.status(404);
    throw new Error('Supplier not found');
  }
  const totalAmount = Number(quantity) * Number(pricePerUnit);
  const activity = await SupplyActivity.create({
    supplier: supplierDoc._id,
    supplierName: supplierDoc.name,
    item,
    quantity,
    pricePerUnit,
    totalAmount,
    date: date || new Date(),
  });
  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Suppliers',
    details: `Recorded supply activity: ${item} x${quantity}`,
  });
  res.status(201).json(activity);
});

module.exports = {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  listActivities,
  createActivity,
};
