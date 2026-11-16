const { asyncHandler } = require('../utils/asyncHandler');
const payments = require('../services/paymentService');

const webhook = asyncHandler(async (req, res) => {
  const data = await payments.handleWebhook({
    gateway: req.params.gateway,
    raw: req.body,
    signature: req.get('X-Signature'),
  });
  res.json(data);
});

module.exports = { webhook };
