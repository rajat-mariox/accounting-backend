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
      Settings.deleteMany({}),
    ]);

    console.log('Seeding users...');
    const admin = await User.create({
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

    console.log('Seeding clients...');
    const [acme, techstart, global] = await Client.create([
      {
        name: 'Acme Corp',
        company: 'Acme Corporation',
        email: 'contact@acme.com',
        phone: '+1-555-0100',
        address: '123 Business St, NY',
      },
      {
        name: 'TechStart Inc',
        company: 'TechStart Inc',
        email: 'hello@techstart.io',
        phone: '+1-555-0200',
        address: '456 Tech Ave, SF',
      },
      {
        name: 'Global Traders',
        company: 'Global Traders LLC',
        email: 'info@globaltraders.com',
        phone: '+1-555-0300',
        address: '789 Trade Blvd, LA',
      },
    ]);

    console.log('Seeding warehouses...');
    const [main, west, south] = await Warehouse.create([
      { name: 'Main Warehouse', location: 'New York', capacity: 10000 },
      { name: 'West Coast Hub', location: 'San Francisco', capacity: 8000 },
      { name: 'Southern Distribution', location: 'Texas', capacity: 6000 },
    ]);

    console.log('Seeding inventory items...');
    const [laptop, mouse, cable, monitor, keyboard] = await InventoryItem.create([
      { name: 'Laptop Pro 15', unit: 'piece', price: 1299, stock: 45, warehouse: main._id, warehouseName: main.name },
      { name: 'Wireless Mouse', unit: 'piece', price: 29, stock: 15, warehouse: main._id, warehouseName: main.name },
      { name: 'USB-C Cable', unit: 'piece', price: 15, stock: 8, warehouse: west._id, warehouseName: west.name },
      { name: 'Monitor 27"', unit: 'piece', price: 399, stock: 120, warehouse: main._id, warehouseName: main.name },
      { name: 'Keyboard Mechanical', unit: 'piece', price: 149, stock: 5, warehouse: west._id, warehouseName: west.name },
    ]);

    console.log('Seeding suppliers + supply activities...');
    const [techSupplies, globalElec] = await Supplier.create([
      { name: 'Tech Supplies Co', company: 'Tech Supplies Co', email: 'contact@techsupplies.com', phone: '+1-555-1000', address: '100 Supply St, NY' },
      { name: 'Global Electronics', company: 'Global Electronics Ltd', email: 'info@globalelec.com', phone: '+1-555-2000', address: '200 Electronics Ave, CA' },
    ]);
    await SupplyActivity.create([
      { supplier: techSupplies._id, supplierName: techSupplies.name, item: 'Laptop Pro 15', quantity: 50, pricePerUnit: 1200, totalAmount: 60000 },
      { supplier: globalElec._id, supplierName: globalElec.name, item: 'Laptop Pro 15', quantity: 100, pricePerUnit: 15, totalAmount: 1500 },
    ]);

    console.log('Seeding invoices + payments...');
    const inv1 = await Invoice.create({
      client: acme._id,
      clientName: acme.name,
      createdDate: new Date('2026-04-01'),
      dueDate: new Date('2026-04-15'),
      items: [
        { name: 'Laptop Pro 15', quantity: 5, price: 1299 },
        { name: 'Monitor 27"', quantity: 10, price: 399 },
      ],
      amount: 5 * 1299 + 10 * 399,
      status: 'paid',
    });
    await Invoice.create({
      client: techstart._id,
      clientName: techstart.name,
      createdDate: new Date('2026-04-08'),
      dueDate: new Date('2026-04-22'),
      items: [{ name: 'Laptop Pro 15', quantity: 1, price: 1299 }],
      amount: 1299,
      status: 'pending',
    });
    await Invoice.create({
      client: global._id,
      clientName: global.name,
      createdDate: new Date('2026-03-20'),
      dueDate: new Date('2026-04-05'),
      items: [{ name: 'USB-C Cable', quantity: 32, price: 15 }],
      amount: 32 * 15,
      status: 'overdue',
    });
    await Payment.create({
      invoice: inv1._id,
      invoiceNumber: inv1.invoiceNumber,
      date: new Date('2026-04-10'),
      amount: inv1.amount,
      mode: 'Bank Transfer',
      reference: 'TXN-001',
    });

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
