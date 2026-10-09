const asyncHandler = require('express-async-handler');
const Settings = require('../models/Settings');
const InventoryItem = require('../models/InventoryItem');
const { recordAudit } = require('../middleware/audit');
const { CURRENCY_DEFAULTS, normalizeCurrencySettings } = require('../services/currencyService');

const SETTING_KEYS = ['company', 'tax', 'inventory', 'currency'];
const DEFAULT_CATEGORY = 'Others';

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
  inventory: {
    categories: ['Electronics', 'Accessories', 'Cables', DEFAULT_CATEGORY],
  },
  currency: CURRENCY_DEFAULTS,
};

// Trim, drop blanks, dedupe case-insensitively, and guarantee the fallback category.
function normalizeCategories(input) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  if (!seen.has(DEFAULT_CATEGORY.toLowerCase())) out.push(DEFAULT_CATEGORY);
  return out;
}

// Read the current category list (used by the inventory controller for validation).
async function getInventoryCategories() {
  const doc = await readSetting('inventory');
  return normalizeCategories(doc.value?.categories);
}

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
  const inventory = await readSetting('inventory');
  const currency = await readSetting('currency');
  res.json({
    company: company.value,
    tax: tax.value,
    inventory: { ...inventory.value, categories: normalizeCategories(inventory.value?.categories) },
    currency: safeCurrency(currency.value),
  });
});

// GET /api/settings/:key
const getSetting = asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (!SETTING_KEYS.includes(key)) {
    res.status(400);
    throw new Error('Unknown setting key');
  }
  const doc = await readSetting(key);
  if (key === 'inventory') {
    res.json({ ...doc.value, categories: normalizeCategories(doc.value?.categories) });
    return;
  }
  if (key === 'currency') {
    res.json(safeCurrency(doc.value));
    return;
  }
  res.json(doc.value);
});

// PUT /api/settings/:key
const updateSetting = asyncHandler(async (req, res) => {
  const { key } = req.params;
  if (!SETTING_KEYS.includes(key)) {
    res.status(400);
    throw new Error('Unknown setting key');
  }
  const doc = await readSetting(key);
  if (key === 'inventory') {
    await updateInventorySettings(doc, req.body, res);
  } else if (key === 'currency') {
    await updateCurrencySettings(doc, req.body, res);
  } else {
    doc.value = { ...doc.value, ...req.body };
  }
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

// Inventory settings hold the category list.
// Body: { categories: string[], renames?: [{ from, to }] }.
// Renames are applied to existing items; a category still in use cannot be removed.
async function updateInventorySettings(doc, body, res) {
  const previous = normalizeCategories(doc.value?.categories);
  const next = normalizeCategories(body.categories ?? previous);

  const renames = Array.isArray(body.renames) ? body.renames : [];
  for (const rename of renames) {
    const from = String(rename?.from ?? '').trim();
    const to = String(rename?.to ?? '').trim();
    if (!from || !to || from === to) continue;
    if (!next.includes(to)) continue;
    await InventoryItem.updateMany({ category: from }, { $set: { category: to } });
  }

  const renamedFrom = new Set(renames.map((r) => String(r?.from ?? '').trim()));
  const removed = previous.filter((name) => !next.includes(name) && !renamedFrom.has(name));
  for (const name of removed) {
    const inUse = await InventoryItem.countDocuments({ category: name });
    if (inUse > 0) {
      res.status(400);
      throw new Error(
        `Cannot remove "${name}": ${inUse} item${inUse === 1 ? '' : 's'} still use it. Reassign them first.`
      );
    }
  }

  doc.value = { ...doc.value, categories: next };
}

function safeCurrency(value) {
  try {
    return normalizeCurrencySettings(value);
  } catch {
    return normalizeCurrencySettings(CURRENCY_DEFAULTS);
  }
}

// Currency settings: base currency, list of currencies with exchange rates
// (units per 1 base), decimals and date format.
// The base cannot change once money records exist (their saved rates are relative
// to it), and a currency still used by a client, invoice or supply cannot be removed.
async function updateCurrencySettings(doc, body, res) {
  const previous = safeCurrency(doc.value);
  let next;
  try {
    next = normalizeCurrencySettings({ ...previous, ...body });
  } catch (err) {
    res.status(400);
    throw err;
  }
  // Lazy requires avoid a circular import through the inventory controller.
  const Invoice = require('../models/Invoice');
  const Payment = require('../models/Payment');
  const Client = require('../models/Client');
  const { SupplyActivity } = require('../models/Supplier');
  if (next.base !== previous.base) {
    const used = (await Invoice.countDocuments()) + (await Payment.countDocuments()) + (await SupplyActivity.countDocuments());
    if (used > 0) {
      res.status(400);
      throw new Error(`The base currency cannot change from ${previous.base} after invoices, payments or supplies exist`);
    }
  }
  const kept = new Set(next.currencies.map((c) => c.code));
  for (const old of previous.currencies) {
    if (kept.has(old.code)) continue;
    const inUse =
      (await Invoice.countDocuments({ currency: old.code })) +
      (await Client.countDocuments({ currency: old.code })) +
      (await SupplyActivity.countDocuments({ currency: old.code }));
    if (inUse > 0) {
      res.status(400);
      throw new Error(`Cannot remove ${old.code}: it is still used by ${inUse} client(s), invoice(s) or supply record(s)`);
    }
  }
  doc.value = next;
}

module.exports = { getAllSettings, getSetting, updateSetting, getInventoryCategories, DEFAULT_CATEGORY };
