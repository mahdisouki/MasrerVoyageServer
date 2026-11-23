const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');
const jwt = require('jsonwebtoken');

require('dotenv').config();

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-value-32bytes!!';
process.env.REFRESH_SECRET = 'test-refresh-secret-value-32b!!';
process.env.QR_SECRET_V1 = 'test-qr-secret-value';
process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.TOTP_ENCRYPTION_KEY = 'test-totp-key';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-storage-'));

let app;
let request;
let User;
let Partner;
let Availability;
let IssuedVoucher;
let Order;
let Invoice;
let orderService;
let catalogue;
let station;
let settings;
let signBody;

function tokenFor(user, amr = 'pwd') {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role, amr, purpose: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' },
  );
}

before(async () => {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  const testUri = process.env.MONGODB_URI.replace(/^(mongodb(?:\+srv)?:\/\/[^/]+)(\/[^?]*)?/, '$1/mastervoyage_test');
  process.env.MONGODB_URI = testUri;
  await require('../config/db').connect(testUri);
  settings = require('../services/settingsService');
  await settings.ensure();
  ({ User, Partner, Availability, IssuedVoucher, Order, Invoice } = require('../models'));
  orderService = require('../services/orderService');
  catalogue = require('../services/catalogueService');
  station = require('../services/stationService');
  ({ signBody } = require('../services/paymentService'));
  app = require('../server').app;
  request = require('supertest');
}, { timeout: 300000 });

after(async () => {
  const mongoose = require('mongoose');
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

async function publishedVoucher(admin, slug, prices = {}) {
  const doc = await catalogue.createVoucherType({
    userId: admin._id,
    body: {
      slug,
      duration: '1 day',
      publicPrice: prices.publicPrice ?? 50000,
      wholesalePrice: prices.wholesalePrice ?? 40000,
      vatRateBps: 1900,
      translations: { fr: { name: 'Journee', description: 'Soin' }, en: { name: 'Day', description: 'Care' } },
    },
  });
  await catalogue.publish(doc._id, admin._id);
  return doc;
}

test('role matrix refuses station operators outside the scan API', async () => {
  const admin = await User.create({ email: 'admin@test.tn', passwordHash: 'x', role: 'admin', totpConfirmedAt: new Date() });
  const stationUser = await User.create({ email: 'station@test.tn', passwordHash: 'x', role: 'station_operator' });
  const customer = await User.create({ email: 'cust@test.tn', passwordHash: 'x', role: 'customer' });
  const open = await request(app).get('/api/v1/vouchers').set('Accept-Language', 'en');
  assert.equal(open.status, 200);
  const blocked = await request(app).get('/api/v1/vouchers').set('Authorization', `Bearer ${tokenFor(stationUser)}`);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'forbidden');
  const adminDenied = await request(app).get('/api/v1/admin/orders').set('Authorization', `Bearer ${tokenFor(stationUser)}`);
  assert.equal(adminDenied.status, 403);
  const customerDenied = await request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${tokenFor(customer)}`);
  assert.equal(customerDenied.status, 403);
  const stats = await request(app).get('/api/v1/admin/stats').set('Authorization', `Bearer ${tokenFor(admin, 'pwd')}`);
  assert.equal(stats.status, 200);
  assert.equal(stats.body.success, true);
});

test('one of two buyers gets the last slot', async () => {
  const admin = await User.findOne({ role: 'admin' });
  const voucher = await publishedVoucher(admin, 'last-slot');
  const { todayTunis, addDays } = require('../utils/dates');
  const day = addDays(todayTunis(), 3);
  await catalogue.setAvailability({ voucherTypeId: voucher._id, day, quota: 1 }, admin._id);
  const bodyFor = (email) => ({
    paymentMode: 'sandbox_card',
    guestEmail: email,
    lines: [{ voucherTypeId: voucher._id.toString(), beneficiaries: [{ name: 'Ali', visitDate: day }] }],
  });
  const settled = await Promise.allSettled([
    orderService.createOrder({ body: bodyFor('a@test.tn'), idempotencyKey: 'slot-a', requestId: 'a', locale: 'en' }),
    orderService.createOrder({ body: bodyFor('b@test.tn'), idempotencyKey: 'slot-b', requestId: 'b', locale: 'en' }),
  ]);
  const ok = settled.filter((item) => item.status === 'fulfilled');
  const denied = settled.filter((item) => item.status === 'rejected' && item.reason.code === 'sold_out');
  assert.equal(ok.length, 1);
  assert.equal(denied.length, 1);
  const row = await Availability.findOne({ voucherTypeId: voucher._id, day });
  assert.equal(row.reserved, 1);
  assert.equal(await Order.countDocuments({ guestEmail: { $in: ['a@test.tn', 'b@test.tn'] } }), 1);
});

test('partner over the credit limit gets no voucher', async () => {
  const admin = await User.findOne({ role: 'admin' });
  const bcrypt = require('bcrypt');
  const user = await User.create({
    email: 'partner@test.tn',
    passwordHash: await bcrypt.hash('password1', 4),
    role: 'partner',
  });
  const voucher = await publishedVoucher(admin, 'credit-day', { wholesalePrice: 30000 });
  const grid = await catalogue.createPriceGrid({ partnerType: 'agency', name: 'Agencies' }, admin._id);
  await catalogue.setGridPrice({ priceGridId: grid._id, voucherTypeId: voucher._id, unitPrice: 30000 }, admin._id);
  const partner = await Partner.create({
    userId: user._id,
    businessName: 'Agence',
    taxId: '123',
    partnerType: 'agency',
    approvalStatus: 'approved',
    creditLimit: 1000,
    paymentDays: 15,
    priceGridId: grid._id,
  });
  const { todayTunis, addDays } = require('../utils/dates');
  const day = addDays(todayTunis(), 1);
  const body = {
    paymentMode: 'credit',
    lines: [{ voucherTypeId: voucher._id.toString(), beneficiaries: [{ name: 'Samir', visitDate: day }] }],
  };
  await assert.rejects(
    () => orderService.createOrder({ body, user, idempotencyKey: 'credit-over', requestId: 'c1', locale: 'en' }),
    (err) => err.code === 'credit_limit_exceeded',
  );
  assert.equal(await IssuedVoucher.countDocuments({ visitDate: day }), 0);
  const fresh = await Partner.findById(partner._id);
  assert.equal(fresh.balance, 0);

  partner.creditLimit = 100000;
  await partner.save();
  const created = await orderService.createOrder({ body, user, idempotencyKey: 'credit-ok', requestId: 'c2', locale: 'en' });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.lines[0].unitPrice, 30000);
  assert.equal(created.body.data.vouchers.length, 1);
  const after = await Partner.findById(partner._id);
  assert.equal(after.balance, created.body.data.total);
  assert.ok(await Invoice.findOne({ orderId: created.body.data.id, docType: 'invoice' }));
});

test('a second scan is refused and a parallel pair yields one success', async () => {
  const admin = await User.findOne({ role: 'admin' });
  const operator = await User.findOne({ role: 'station_operator' });
  const partnerUser = await User.findOne({ email: 'partner@test.tn' });
  const voucher = await catalogue.createVoucherType({
    userId: admin._id,
    body: {
      slug: 'scan-day',
      duration: 'scan',
      publicPrice: 10000,
      wholesalePrice: 10000,
      vatRateBps: 0,
      translations: { fr: { name: 'Scan', description: 'Scan' } },
    },
  });
  await catalogue.publish(voucher._id, admin._id);
  const { todayTunis } = require('../utils/dates');
  const day = todayTunis();
  const created = await orderService.createOrder({
    body: {
      paymentMode: 'credit',
      lines: [{ voucherTypeId: voucher._id.toString(), beneficiaries: [{ name: 'Leila', visitDate: day }] }],
    },
    user: partnerUser,
    idempotencyKey: 'scan-order',
    requestId: 'scan',
    locale: 'en',
  });
  const qr = created.body.data.vouchers[0].qrToken;
  const [one, two] = await Promise.all([
    station.scan({ token: qr, operator, deviceId: 'a' }),
    station.scan({ token: qr, operator, deviceId: 'b' }),
  ]);
  const codes = [one.body.code, two.body.code].sort();
  assert.deepEqual(codes, ['already_used', 'valid']);
  const again = await station.scan({ token: qr, operator, deviceId: 'c' });
  assert.equal(again.body.code, 'already_used');
  assert.ok(again.body.data.usedAt);
  assert.equal(again.body.data.operatorEmail, operator.email);
});

test('the same Idempotency-Key does not create a second order', async () => {
  const admin = await User.findOne({ role: 'admin' });
  const voucher = await publishedVoucher(admin, 'idem-day');
  const { todayTunis, addDays } = require('../utils/dates');
  const day = addDays(todayTunis(), 4);
  const payload = {
    paymentMode: 'sandbox_card',
    guestEmail: 'guest@test.tn',
    lines: [{ voucherTypeId: voucher._id.toString(), beneficiaries: [{ name: 'Nour', visitDate: day }] }],
  };
  const first = await request(app).post('/api/v1/orders').set('Idempotency-Key', 'same-key').send(payload);
  const second = await request(app).post('/api/v1/orders').set('Idempotency-Key', 'same-key').send(payload);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.body.data.id, first.body.data.id);
  assert.equal(await Order.countDocuments({ guestEmail: 'guest@test.tn' }), 1);
});

test('a duplicated webhook issues one voucher', async () => {
  const customer = await User.findOne({ email: 'cust@test.tn' });
  const admin = await User.findOne({ role: 'admin' });
  const voucher = await publishedVoucher(admin, 'pay-day');
  const { todayTunis, addDays } = require('../utils/dates');
  const day = addDays(todayTunis(), 5);
  const auth = tokenFor(customer);
  const created = await request(app)
    .post('/api/v1/orders')
    .set('Authorization', `Bearer ${auth}`)
    .set('Idempotency-Key', 'pay-order')
    .send({
      paymentMode: 'sandbox_card',
      lines: [{ voucherTypeId: voucher._id.toString(), beneficiaries: [{ name: 'Hatem', visitDate: day }] }],
    });
  assert.equal(created.status, 201);
  const payment = await request(app)
    .post(`/api/v1/orders/${created.body.data.id}/payments`)
    .set('Authorization', `Bearer ${auth}`)
    .set('Idempotency-Key', 'pay-1')
    .send({});
  assert.equal(payment.status, 201);
  const raw = JSON.stringify({ eventId: 'evt-1', reference: payment.body.data.reference, status: 'succeeded' });
  const signature = signBody(raw);
  const post = () => request(app)
    .post('/api/v1/webhooks/payments/sandbox')
    .set('Content-Type', 'application/json')
    .set('X-Signature', signature)
    .send(raw);
  const first = await post();
  const second = await post();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.code, 'duplicate');
  assert.equal(await IssuedVoucher.countDocuments({ beneficiary: 'Hatem' }), 1);
});

test('cancelling a paid order invalidates the voucher', async () => {
  const admin = await User.findOne({ role: 'admin' });
  const partnerUser = await User.findOne({ email: 'partner@test.tn' });
  const operator = await User.findOne({ role: 'station_operator' });
  const voucher = await publishedVoucher(admin, 'cancel-day', { publicPrice: 20000, wholesalePrice: 20000 });
  const { todayTunis, addDays } = require('../utils/dates');
  const day = addDays(todayTunis(), 6);
  const created = await orderService.createOrder({
    body: {
      paymentMode: 'credit',
      lines: [{ voucherTypeId: voucher._id.toString(), beneficiaries: [{ name: 'Rami', visitDate: day }] }],
    },
    user: partnerUser,
    idempotencyKey: 'cancel-order',
    requestId: 'cancel',
    locale: 'en',
  });
  const cancelled = await orderService.cancelOrder({
    orderId: created.body.data.id,
    actor: admin,
    reason: 'customer request',
    refundAmount: created.body.data.total,
    idempotencyKey: 'cancel-1',
    locale: 'en',
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.status, 'refunded');
  const note = await Invoice.findOne({ orderId: created.body.data.id, docType: 'credit_note' });
  assert.ok(note);
  const scan = await station.scan({ token: created.body.data.vouchers[0].qrToken, operator, deviceId: 'desk' });
  assert.equal(scan.body.code, 'cancelled');
});

test('admin availability lists the daily quota for a bon', async () => {
  const admin = await User.create({ email: 'quota-admin@test.tn', passwordHash: 'x', role: 'admin' });
  const voucher = await publishedVoucher(admin, 'quota-month');
  const { todayTunis } = require('../utils/dates');
  const day = todayTunis();
  await catalogue.setAvailability({ voucherTypeId: voucher._id, day, quota: 4 }, admin._id);
  const days = await catalogue.adminMonthAvailability(voucher._id, day.slice(0, 7));
  const row = days.find((item) => item.day === day);
  assert.equal(row.quota, 4);
  assert.equal(row.sold, 0);
  assert.equal(row.reserved, 0);
  assert.equal(row.remaining, 4);
  const agent = await User.create({ email: 'quota-agent@test.tn', passwordHash: 'x', role: 'agent' });
  const denied = await request(app)
    .put('/api/v1/admin/availability')
    .set('Authorization', `Bearer ${tokenFor(agent)}`)
    .send({ voucherTypeId: voucher._id.toString(), day, quota: 2 });
  assert.equal(denied.status, 403);
});

test('one quantity fills every day of the month', async () => {
  const admin = await User.create({ email: 'month-admin@test.tn', passwordHash: 'x', role: 'admin' });
  const voucher = await publishedVoucher(admin, 'month-fill');
  const month = '2026-11';
  const filled = await catalogue.setMonthQuota({ voucherTypeId: voucher._id, month, quota: 12 }, admin._id);
  assert.equal(filled.days, 30);
  const days = await catalogue.adminMonthAvailability(voucher._id, month);
  assert.equal(days.length, 30);
  assert.ok(days.every((day) => day.quota === 12));
  await Availability.updateOne({ voucherTypeId: voucher._id, day: '2026-11-02' }, { sold: 20 });
  await assert.rejects(
    () => catalogue.setMonthQuota({ voucherTypeId: voucher._id, month, quota: 5 }, admin._id),
    (err) => err.code === 'quota_too_low',
  );
  const kept = await Availability.findOne({ voucherTypeId: voucher._id, day: '2026-11-01' });
  assert.equal(kept.quota, 12);
});

test('an agent can close a day and a new order is refused', async () => {
  const admin = await User.create({ email: 'block-admin@test.tn', passwordHash: 'x', role: 'admin' });
  const agent = await User.create({ email: 'block-agent@test.tn', passwordHash: 'x', role: 'agent' });
  const customer = await User.create({ email: 'block-customer@test.tn', passwordHash: 'x', role: 'customer' });
  const voucher = await publishedVoucher(admin, 'block-day');
  const { addDays, todayTunis } = require('../utils/dates');
  const day = addDays(todayTunis(), 4);
  const customerDenied = await request(app)
    .put('/api/v1/admin/availability/block')
    .set('Authorization', `Bearer ${tokenFor(customer)}`)
    .send({ voucherTypeId: voucher._id.toString(), day, blocked: true });
  assert.equal(customerDenied.status, 403);
  const closed = await request(app)
    .put('/api/v1/admin/availability/block')
    .set('Authorization', `Bearer ${tokenFor(agent)}`)
    .send({ voucherTypeId: voucher._id.toString(), day, blocked: true });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.data.blocked, true);
  await assert.rejects(
    () => orderService.createOrder({
      body: {
        paymentMode: 'sandbox_card',
        guestEmail: 'buyer-block@test.tn',
        lines: [{ voucherTypeId: voucher._id.toString(), beneficiaries: [{ name: 'Ines', visitDate: day }] }],
      },
      idempotencyKey: 'block-order',
      requestId: 'block',
      locale: 'fr',
    }),
    (err) => err.code === 'day_blocked',
  );
  const days = await catalogue.monthAvailability(voucher._id, day.slice(0, 7));
  assert.equal(days.find((item) => item.day === day).available, false);
  const opened = await request(app)
    .put('/api/v1/admin/availability/block')
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .send({ voucherTypeId: voucher._id.toString(), day, blocked: false });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.data.blocked, false);
});

test('only an admin can create and update users', async () => {
  const admin = await User.create({ email: 'users-admin@test.tn', passwordHash: 'x', role: 'admin' });
  const agent = await User.create({ email: 'users-agent@test.tn', passwordHash: 'x', role: 'agent' });
  const adminToken = tokenFor(admin);
  const agentToken = tokenFor(agent);

  const denied = await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${agentToken}`)
    .send({ email: 'blocked-user@test.tn', password: 'password1', role: 'agent' });
  assert.equal(denied.status, 403);

  const created = await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Accept-Language', 'fr')
    .send({
      email: 'new-customer@test.tn',
      password: 'password1',
      role: 'customer',
      firstName: 'Sami',
      language: 'fr',
    });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.role, 'customer');
  assert.equal(created.body.data.status, 'active');

  const partnerRole = await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email: 'no-partner@test.tn', password: 'password1', role: 'partner' });
  assert.equal(partnerRole.status, 422);
  assert.equal(partnerRole.body.code, 'role_not_allowed');

  const duplicate = await request(app)
    .post('/api/v1/admin/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email: 'new-customer@test.tn', password: 'password1', role: 'agent' });
  assert.equal(duplicate.status, 409);

  const disabled = await request(app)
    .patch(`/api/v1/admin/users/${created.body.data.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'disabled' });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.data.status, 'disabled');

  const selfDisable = await request(app)
    .patch(`/api/v1/admin/users/${admin._id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ status: 'disabled' });
  assert.equal(selfDisable.status, 409);
  assert.equal(selfDisable.body.code, 'cannot_disable_self');

  const others = await User.find({ role: 'admin', status: 'active', _id: { $ne: admin._id } });
  await User.updateMany({ _id: { $in: others.map((item) => item._id) } }, { status: 'disabled' });
  try {
    const lastAdmin = await request(app)
      .patch(`/api/v1/admin/users/${admin._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'agent' });
    assert.equal(lastAdmin.status, 409);
    assert.equal(lastAdmin.body.code, 'last_admin');
  } finally {
    await User.updateMany({ _id: { $in: others.map((item) => item._id) } }, { status: 'active' });
  }
});

test('a published treatment is visible on the public soins list', async () => {
  const admin = await User.create({ email: 'care-admin@test.tn', passwordHash: 'x', role: 'admin' });
  const agent = await User.create({ email: 'care-agent@test.tn', passwordHash: 'x', role: 'agent' });
  const denied = await request(app)
    .post('/api/v1/admin/treatments')
    .set('Authorization', `Bearer ${tokenFor(agent)}`)
    .send({
      slug: 'bain-individuel',
      category: 'baths',
      duration: '45 min',
      translations: { fr: { name: 'Bain individuel' } },
    });
  assert.equal(denied.status, 403);
  const created = await request(app)
    .post('/api/v1/admin/treatments')
    .set('Authorization', `Bearer ${tokenFor(admin)}`)
    .send({
      slug: 'bain-individuel',
      category: 'baths',
      duration: '45 min',
      publicPrice: 45000,
      featured: true,
      translations: {
        fr: {
          name: 'Bain individuel',
          summary: 'Un bain à la source.',
          benefits: 'Détente\nChaleur',
        },
      },
    });
  assert.equal(created.status, 201);
  const hidden = await request(app).get('/api/v1/treatments').set('Accept-Language', 'fr');
  assert.equal(hidden.body.data.some((item) => item.slug === 'bain-individuel'), false);
  const published = await request(app)
    .post(`/api/v1/admin/treatments/${created.body.data._id}/publish`)
    .set('Authorization', `Bearer ${tokenFor(admin)}`);
  assert.equal(published.status, 200);
  const listed = await request(app).get('/api/v1/treatments').set('Accept-Language', 'fr');
  const row = listed.body.data.find((item) => item.slug === 'bain-individuel');
  assert.equal(row.name, 'Bain individuel');
  assert.deepEqual(row.benefitLines, ['Détente', 'Chaleur']);
  assert.equal(row.publicPrice, 45000);
});
