// One-off: renumber legacy invoices (INV-…) into the JGC-MM-### format, in
// created-date order, and move the sequence counter past them. Payments that
// store the old number are updated too. Safe to re-run: JGC-* invoices are skipped.
//   node src/utils/renumberInvoices.js
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Invoice = require('../models/Invoice');
const Payment = require('../models/Payment');
const Counter = require('../models/Counter');

(async () => {
  try {
    await connectDB();
    const legacy = await Invoice.find({ invoiceNumber: { $not: /^JGC-/ } })
      .sort({ createdDate: 1, createdAt: 1 })
      .select('_id invoiceNumber createdDate');
    if (legacy.length === 0) {
      console.log('No legacy invoices to renumber.');
      return;
    }
    for (const invoice of legacy) {
      const oldNumber = invoice.invoiceNumber;
      const newNumber = await Invoice.nextInvoiceNumber(invoice.createdDate || new Date());
      await Invoice.updateOne({ _id: invoice._id }, { $set: { invoiceNumber: newNumber } });
      const payments = await Payment.updateMany({ invoice: invoice._id }, { $set: { invoiceNumber: newNumber } });
      console.log(`${oldNumber} -> ${newNumber} (${payments.modifiedCount} payment(s) updated)`);
    }
    const counter = await Counter.findOne({ key: 'invoice' }).lean();
    console.log(`Done. Next invoice will be sequence ${(counter?.seq || 0) + 1}.`);
  } catch (err) {
    console.error('Renumber failed:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
})();
