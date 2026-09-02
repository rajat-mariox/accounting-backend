const asyncHandler = require('express-async-handler');
const Client = require('../models/Client');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const { recordAudit } = require('../middleware/audit');

const MIN_PASSWORD = 6;

// Percent fields: undefined = leave unchanged; otherwise 0..100.
function validatePricing({ discountPercent, taxRate }, res) {
  const out = {};
  for (const [key, value] of Object.entries({ discountPercent, taxRate })) {
    if (value === undefined) continue;
    const n = value === '' || value === null ? 0 : Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      res.status(400);
      throw new Error(`${key === 'taxRate' ? 'Tax rate' : 'Discount'} must be between 0 and 100`);
    }
    out[key] = n;
  }
  return out;
}

async function assertEmailFree(email, res, excludeUserId) {
  const filter = { email: String(email).toLowerCase() };
  if (excludeUserId) filter._id = { $ne: excludeUserId };
  if (await User.exists(filter)) {
    res.status(400);
    throw new Error('An account with this email already exists');
  }
}

// GET /api/clients
const listClients = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const filter = q
    ? {
        $or: [
          { name: { $regex: q, $options: 'i' } },
          { company: { $regex: q, $options: 'i' } },
          { email: { $regex: q, $options: 'i' } },
        ],
      }
    : {};
  const clients = await Client.find(filter).sort({ created: -1 });
  res.json(clients);
});

// GET /api/clients/:id
const getClient = asyncHandler(async (req, res) => {
  const client = await Client.findById(req.params.id);
  if (!client) {
    res.status(404);
    throw new Error('Client not found');
  }
  const invoiceHistory = await Invoice.find({ client: client._id })
    .sort({ createdDate: -1 })
    .select('invoiceNumber createdDate amount status');
  const login = client.user ? await User.findById(client.user).select('email status lastLogin') : null;
  res.json({ ...client.toObject(), invoiceHistory, login });
});

// POST /api/clients
const createClient = asyncHandler(async (req, res) => {
  const { name, company, email, phone, address, password, discountPercent, taxRate } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Name is required');
  }
  const pricing = validatePricing({ discountPercent, taxRate }, res);
  if (!email) {
    res.status(400);
    throw new Error('Email is required for the client login');
  }
  if (!password || String(password).length < MIN_PASSWORD) {
    res.status(400);
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
  }
  await assertEmailFree(email, res);

  const client = await Client.create({ name, company, email, phone, address, ...pricing });
  try {
    const portalUser = await User.create({
      name,
      email,
      password,
      phone,
      role: 'Client',
      client: client._id,
    });
    client.user = portalUser._id;
    await client.save();
  } catch (err) {
    await client.deleteOne();
    throw err;
  }

  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Clients',
    details: `Added new client: ${client.name} (portal login ${client.email})`,
  });
  res.status(201).json(client);
});

// PUT /api/clients/:id
const updateClient = asyncHandler(async (req, res) => {
  const client = await Client.findById(req.params.id);
  if (!client) {
    res.status(404);
    throw new Error('Client not found');
  }
  const { password } = req.body;
  if (password !== undefined && password !== '' && String(password).length < MIN_PASSWORD) {
    res.status(400);
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
  }
  if (req.body.email !== undefined && !req.body.email) {
    res.status(400);
    throw new Error('Email is required for the client login');
  }

  let portalUser = client.user ? await User.findById(client.user) : null;
  if (req.body.email !== undefined) {
    await assertEmailFree(req.body.email, res, portalUser?._id);
  }

  ['name', 'company', 'email', 'phone', 'address'].forEach((field) => {
    if (req.body[field] !== undefined) client[field] = req.body[field];
  });
  Object.assign(client, validatePricing(req.body, res));
  await client.save();

  // Keep the portal login in sync; create one for clients that predate logins
  // when a password is supplied.
  if (portalUser) {
    portalUser.name = client.name;
    portalUser.email = client.email;
    portalUser.phone = client.phone;
    if (password) portalUser.password = password;
    await portalUser.save();
  } else if (password && client.email) {
    portalUser = await User.create({
      name: client.name,
      email: client.email,
      password,
      phone: client.phone,
      role: 'Client',
      client: client._id,
    });
    client.user = portalUser._id;
    await client.save();
  }
  await recordAudit({
    user: req.user,
    action: 'Update',
    module: 'Clients',
    details: `Updated client: ${client.name}`,
  });
  res.json(client);
});

// DELETE /api/clients/:id
const deleteClient = asyncHandler(async (req, res) => {
  const client = await Client.findById(req.params.id);
  if (!client) {
    res.status(404);
    throw new Error('Client not found');
  }
  if (client.user) await User.deleteOne({ _id: client.user, role: 'Client' });
  await client.deleteOne();
  await recordAudit({
    user: req.user,
    action: 'Delete',
    module: 'Clients',
    details: `Deleted client: ${client.name}`,
  });
  res.json({ message: 'Client deleted' });
});

module.exports = { listClients, getClient, createClient, updateClient, deleteClient };
