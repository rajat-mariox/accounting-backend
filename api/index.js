// Vercel serverless entry point.
// server.js (app.listen) is for local dev; Vercel invokes this handler instead,
// so the Mongo connection must be established (and cached) per lambda instance.
require('dotenv').config();
const mongoose = require('mongoose');
const app = require('../src/app');

let connPromise = null;

async function ensureDB() {
  if (mongoose.connection.readyState === 1) return;
  if (!connPromise) {
    connPromise = mongoose.connect(process.env.MONGO_URI).catch((err) => {
      connPromise = null;
      throw err;
    });
  }
  await connPromise;
}

module.exports = async (req, res) => {
  try {
    await ensureDB();
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Database connection failed' }));
    return;
  }
  return app(req, res);
};
