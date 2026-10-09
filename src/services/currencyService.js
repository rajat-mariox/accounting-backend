const Settings = require('../models/Settings');

// Exchange rates are "units of this currency per 1 unit of the base currency".
// Converting a document amount to the base currency is therefore amount / rate.
// The sample rates below are placeholders; the administrator sets real ones in
// Settings -> Currency & Region.
const CURRENCY_DEFAULTS = {
  base: 'USD',
  decimals: 2,
  dateFormat: 'DD/MM/YYYY',
  currencies: [
    { code: 'USD', name: 'US Dollar', symbol: '$', rate: 1 },
    { code: 'SOS', name: 'Somali Shilling', symbol: 'Sh', rate: 571 },
  ],
};

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];

const round = (n, places = 6) => Math.round(Number(n) * 10 ** places) / 10 ** places;

// Clean and validate a currency settings object. Throws Error with a user-facing message.
function normalizeCurrencySettings(input) {
  const value = { ...CURRENCY_DEFAULTS, ...(input || {}) };
  const seen = new Set();
  const currencies = [];
  for (const raw of Array.isArray(value.currencies) ? value.currencies : []) {
    const code = String(raw?.code ?? '').trim().toUpperCase();
    if (!code) continue;
    if (!/^[A-Z]{3}$/.test(code)) throw new Error(`Currency code "${code}" must be 3 letters, e.g. USD`);
    if (seen.has(code)) throw new Error(`Currency ${code} is listed twice`);
    seen.add(code);
    const rate = Number(raw.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error(`Exchange rate for ${code} must be greater than 0`);
    currencies.push({
      code,
      name: String(raw.name ?? '').trim() || code,
      symbol: String(raw.symbol ?? '').trim() || code,
      rate: round(rate),
    });
  }
  const base = String(value.base ?? '').trim().toUpperCase();
  const baseEntry = currencies.find((c) => c.code === base);
  if (!baseEntry) throw new Error('The base currency must be one of the listed currencies');
  baseEntry.rate = 1;
  const decimals = Number(value.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 3) throw new Error('Decimals must be 0, 1, 2 or 3');
  if (!DATE_FORMATS.includes(value.dateFormat)) throw new Error(`Date format must be one of ${DATE_FORMATS.join(', ')}`);
  return { base, decimals, dateFormat: value.dateFormat, currencies };
}

async function getCurrencySettings() {
  const doc = await Settings.findOne({ key: 'currency' }).lean();
  try {
    return normalizeCurrencySettings(doc?.value);
  } catch {
    return normalizeCurrencySettings(CURRENCY_DEFAULTS);
  }
}

// Resolve a currency code (or the base when empty) to { code, rate }; throws (400) when unknown.
async function resolveCurrency(code, res) {
  const settings = await getCurrencySettings();
  const wanted = String(code ?? '').trim().toUpperCase() || settings.base;
  const entry = settings.currencies.find((c) => c.code === wanted);
  if (!entry) {
    if (res) res.status(400);
    throw new Error(`Unknown currency "${wanted}". Add it under Settings -> Currency & Region first.`);
  }
  return { code: entry.code, rate: entry.rate, settings };
}

// Use a caller-supplied exchange rate when valid, otherwise the configured one.
function pickRate(override, fallback) {
  const n = Number(override);
  return Number.isFinite(n) && n > 0 ? round(n) : fallback;
}

// Mongo expression converting a money field to the base currency.
const toBaseExpr = (field, rateField = '$exchangeRate') => ({
  $divide: [field, { $cond: [{ $gt: [{ $ifNull: [rateField, 0] }, 0] }, rateField, 1] }],
});

const toBase = (amount, rate) => Number(amount || 0) / (Number(rate) > 0 ? Number(rate) : 1);

module.exports = {
  CURRENCY_DEFAULTS,
  DATE_FORMATS,
  normalizeCurrencySettings,
  getCurrencySettings,
  resolveCurrency,
  pickRate,
  toBaseExpr,
  toBase,
};
