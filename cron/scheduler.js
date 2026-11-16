const cron = require('node-cron');
const { processDueJobs } = require('../services/jobRunner');
const { expireOrders } = require('../services/orderService');
const { reconcilePayments } = require('../services/paymentService');
const { expireVouchers } = require('../services/voucherService');
const { creditChecks, auditBalances } = require('../services/partnerService');

function guard(name, fn) {
  return () => {
    Promise.resolve(fn()).catch((err) => {
      console.error(`[cron] ${name}`, err.message);
    });
  };
}

function start() {
  cron.schedule('* * * * *', guard('jobs', async () => {
    await processDueJobs();
    await processDueJobs();
    await processDueJobs();
  }));
  cron.schedule('* * * * *', guard('expire-orders', expireOrders));
  cron.schedule('*/5 * * * *', guard('reconcile', reconcilePayments));
  cron.schedule('5 0 * * *', guard('daily', async () => {
    await expireVouchers();
    await creditChecks();
    await auditBalances();
  }), { timezone: 'Africa/Tunis' });
}

module.exports = { start };
