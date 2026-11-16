const ROLES = ['customer', 'partner', 'agent', 'admin', 'station_operator'];
const LOCALES = ['fr', 'ar', 'en'];
const PAYMENT_MODES = ['sandbox_card', 'agency', 'credit'];
const ORDER_STATUSES = [
  'pending_payment', 'paid', 'credit_approved', 'fulfilled',
  'expired', 'failed', 'cancelled', 'refunded',
];
const VOUCHER_STATUSES = ['issued', 'used', 'expired', 'cancelled', 'refunded'];
const PARTNER_TYPES = ['agency', 'hotel', 'reseller'];
const PARTNER_STATUSES = ['pending', 'approved', 'rejected', 'suspended', 'blocked_credit'];

module.exports = {
  ROLES, LOCALES, PAYMENT_MODES, ORDER_STATUSES, VOUCHER_STATUSES, PARTNER_TYPES, PARTNER_STATUSES,
};
