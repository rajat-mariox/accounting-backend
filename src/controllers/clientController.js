const asyncHandler = require('express-async-handler');
const Client = require('../models/Client');
const Invoice = require('../models/Invoice');
const { recordAudit } = require('../middleware/audit');

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
  res.json({ ...client.toObject(), invoiceHistory });
});

// POST /api/clients
const createClient = asyncHandler(async (req, res) => {
  const { name, company, email, phone, address } = req.body;
  if (!name) {
    res.status(400);
    throw new Error('Name is required');
  }
  const client = await Client.create({ name, company, email, phone, address });
  await recordAudit({
    user: req.user,
    action: 'Create',
    module: 'Clients',
    details: `Added new client: ${client.name}`,
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
  ['name', 'company', 'email', 'phone', 'address'].forEach((field) => {
    if (req.body[field] !== undefined) client[field] = req.body[field];
  });
  await client.save();
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
