const { Order, IssuedVoucher } = require('../models');

async function summary() {
  const [orders, issued, used] = await Promise.all([
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$total' } } }]),
    IssuedVoucher.countDocuments({}),
    IssuedVoucher.countDocuments({ status: 'used' }),
  ]);
  const paidStatuses = new Set(['paid', 'credit_approved', 'fulfilled', 'refunded']);
  const revenueMillimes = orders
    .filter((row) => paidStatuses.has(row._id))
    .reduce((sum, row) => sum + row.total, 0);
  return {
    ordersByStatus: orders,
    revenueMillimes,
    vouchersIssued: issued,
    vouchersUsed: used,
  };
}

module.exports = { summary };
