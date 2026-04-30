const mongoose = require('mongoose');
// const dns = require('dns');

// dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set. Check your .env file.');
    process.exit(1);
  }
  try {
    await mongoose.connect(uri);
    console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
