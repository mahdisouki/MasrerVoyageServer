const mongoose = require('mongoose');

async function connect(uri) {
  if (!uri) throw new Error('MONGODB_URI is required');
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  return mongoose.connection;
}

module.exports = { connect };
