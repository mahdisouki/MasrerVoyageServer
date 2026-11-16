require('dotenv').config();
const { assertEnv } = require('../config/env');
const { connect } = require('../config/db');
const { User } = require('../models');
const auth = require('../services/authService');
const settings = require('../services/settingsService');

async function seed() {
  assertEnv();
  if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  }
  await connect(process.env.MONGODB_URI);
  await settings.ensure();
  const email = process.env.ADMIN_EMAIL.toLowerCase();
  const existing = await User.findOne({ email });
  if (existing) {
    console.log('Admin already exists');
    return;
  }
  await auth.createStaff({
    email,
    password: process.env.ADMIN_PASSWORD,
    role: 'admin',
    language: 'fr',
  });
  console.log(`Admin created: ${email}`);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
