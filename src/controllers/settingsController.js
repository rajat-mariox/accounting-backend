const asyncHandler = require('express-async-handler');
const Settings = require('../models/Settings');
const { recordAudit } = require('../middleware/audit');

const DEFAULTS = {
  company: {
    name: 'AccounTech ERP',
    email: 'contact@accounttech.com',
    phone: '+1-555-0199',
    address: '123 Business Avenue, New York, NY 10001',
  },
  tax: {
    rate: 10,
    registrationNumber: 'TAX-123456789',
  },
};

async function readSetting(key) {
  let doc = await Settings.findOne({ key });
  if (!doc) {
    doc = await Settings.create({ key, value: DEFAULTS[key] || {} });
  }
  return doc;
}

// GET /api/settings
const getAllSettings = asyncHandler(async (_req, res) => {
  const company = await readSetting('company');
  const tax = await readSetting('tax');
  res.json({ company: company.value, tax: tax.value });
});

// GET /api/settings/:key
const getSetting = asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (!['company', 'tax'].includes(key)) {
    res.status(400);
    throw new Error('Unknown setting key');
  }
  const doc = await readSetting(key);
  res.json(doc.value);
});

// PUT /api/settings/:key
const updateSetting = asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (!['company', 'tax'].includes(key)) {
    res.status(400);
    throw new Error('Unknown setting key');
  }
  const doc = await readSetting(key);
  doc.value = { ...doc.value, ...req.body };
  doc.markModified('value');
  await doc.save();
  await recordAudit({
    user: req.user,
    action: 'Update',
    module: 'Settings',
    details: `Updated ${key} settings`,
  });
  res.json(doc.value);
});

module.exports = { getAllSettings, getSetting, updateSetting };
