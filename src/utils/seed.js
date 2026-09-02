require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const User = require('../models/User');
const Client = require('../models/Client');
const { Supplier, SupplyActivity } = require('../models/Supplier');
const Warehouse = require('../models/Warehouse');
const InventoryItem = require('../models/InventoryItem');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Transfer = require('../models/Transfer');
const Notification = require('../models/Notification');
const AuditLog = require('../models/AuditLog');
const Settings = require('../models/Settings');

(async () => {
  try {
    await connectDB();
    console.log('Clearing existing collections...');
    await Promise.all([
      User.deleteMany({}),
      Client.deleteMany({}),
      Supplier.deleteMany({}),
      SupplyActivity.deleteMany({}),
      Warehouse.deleteMany({}),
      InventoryItem.deleteMany({}),
      Invoice.deleteMany({}),
      Payment.deleteMany({}),
      Transfer.deleteMany({}),
      Notification.deleteMany({}),
      AuditLog.deleteMany({}),
      Settings.deleteMany({}),
    ]);

    console.log('Seeding users...');
    await User.create({
      name: 'Admin User',
      email: 'admin@accountech.com',
      password: 'admin1234',
      phone: '+1-555-0001',
      role: 'Administrator',
      status: 'active',
    });
    await User.create({
      name: 'John Manager',
      email: 'john.manager@accountech.com',
      password: 'manager1234',
      phone: '+1-555-0002',
      role: 'Manager',
    });
    await User.create({
      name: 'Sarah Accountant',
      email: 'sarah.acc@accountech.com',
      password: 'accountant1234',
      phone: '+1-555-0003',
      role: 'Accountant',
    });

    // Demo business data (clients, suppliers, inventory, warehouses, invoices,
    // payments) is intentionally not seeded — real data is entered through the app.

    console.log('Seeding settings...');
    await Settings.create([
      {
        key: 'company',
        value: {
          name: 'AccounTech ERP',
          email: 'contact@accounttech.com',
          phone: '+1-555-0199',
          address: '123 Business Avenue, New York, NY 10001',
        },
      },
      {
        key: 'tax',
        value: { rate: 10, registrationNumber: 'TAX-123456789' },
      },
      {
        key: 'inventory',
        value: { categories: ['Electronics', 'Accessories', 'Cables', 'Others'] },
      },
    ]);

    console.log('Seed complete.');
    console.log('Login: admin@accountech.com / admin1234');
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
