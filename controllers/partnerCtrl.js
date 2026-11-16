const { asyncHandler } = require('../utils/asyncHandler');
const partners = require('../services/partnerService');
const orders = require('../services/orderService');

const register = asyncHandler(async (req, res) => {
  const data = await partners.register(req.body, req.files);
  res.status(201).json({ success: true, data });
});

const wholesale = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await partners.listWholesale(req.user, req.locale) });
});

const dashboard = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await partners.dashboard(req.user) });
});

const statement = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await partners.statement(req.user, req.query) });
});

const exportOrders = asyncHandler(async (req, res) => {
  const csv = await partners.exportOrders(req.user);
  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

const createOrder = asyncHandler(async (req, res) => {
  const result = await orders.createOrder({
    body: req.body,
    user: req.user,
    idempotencyKey: req.get('Idempotency-Key'),
    requestId: req.id,
    locale: req.locale,
  });
  res.status(result.status).json(result.body);
});

module.exports = { register, wholesale, dashboard, statement, exportOrders, createOrder };
