const express = require('express');
const authCtrl = require('../controllers/authCtrl');
const publicCtrl = require('../controllers/publicCtrl');
const adminCtrl = require('../controllers/adminCtrl');
const partnerCtrl = require('../controllers/partnerCtrl');
const stationCtrl = require('../controllers/stationCtrl');
const { isAuth, purposeAuth, optionalAuth } = require('../middlewares/auth');
const { checkRole, requirePrivileged } = require('../middlewares/role');
const { loginLimiter, registerLimiter, guestAccessLimiter, scanLimiter } = require('../middlewares/rateLimiter');
const { upload } = require('../middlewares/upload');

const router = express.Router();

router.post('/auth/register', registerLimiter, authCtrl.register);
router.post('/auth/login', loginLimiter, authCtrl.login);
router.post('/auth/refresh', authCtrl.refresh);
router.post('/auth/logout', isAuth, authCtrl.logout);
router.post('/auth/password/forgot', loginLimiter, authCtrl.forgotPassword);
router.post('/auth/password/reset', authCtrl.resetPassword);
router.post('/auth/2fa/setup', purposeAuth('2fa_setup'), authCtrl.setup2fa);
router.post('/auth/2fa/confirm', purposeAuth('2fa_setup'), authCtrl.confirm2fa);
router.post('/auth/2fa/verify', purposeAuth('2fa'), authCtrl.verify2fa);

router.get('/vouchers', optionalAuth, publicCtrl.listVouchers);
router.get('/vouchers/:id/availability', optionalAuth, publicCtrl.availability);
router.get('/vouchers/:id', optionalAuth, publicCtrl.getVoucher);
router.get('/vouchers/issued/:id/pdf', isAuth, checkRole('customer', 'partner', 'admin', 'agent'), requirePrivileged, publicCtrl.voucherPdf);

router.post('/orders', optionalAuth, publicCtrl.createOrder);
router.get('/orders', isAuth, checkRole('customer', 'partner'), publicCtrl.listOrders);
router.post('/orders/access', guestAccessLimiter, publicCtrl.guestAccess);
router.get('/orders/access/:token', publicCtrl.byToken);
router.get('/orders/:id', isAuth, checkRole('customer', 'partner'), publicCtrl.getOrder);
router.post('/orders/:id/cancellation-requests', isAuth, checkRole('customer', 'partner'), publicCtrl.cancellationRequest);
router.post('/orders/:id/payments', optionalAuth, publicCtrl.createPayment);

router.get('/me/vouchers', isAuth, checkRole('customer', 'partner'), publicCtrl.myVouchers);
router.post('/me/vouchers/:id/resend', isAuth, checkRole('customer', 'partner'), publicCtrl.resendVoucher);
router.get('/me/invoices', isAuth, checkRole('customer', 'partner'), publicCtrl.myInvoices);
router.get('/invoices/:id/pdf', isAuth, publicCtrl.invoicePdf);

router.post('/partners/register', registerLimiter, upload.array('documents', 5), partnerCtrl.register);
router.get('/partner/vouchers', isAuth, checkRole('partner'), partnerCtrl.wholesale);
router.get('/partner/dashboard', isAuth, checkRole('partner'), partnerCtrl.dashboard);
router.get('/partner/statement', isAuth, checkRole('partner'), partnerCtrl.statement);
router.get('/partner/exports/orders', isAuth, checkRole('partner'), partnerCtrl.exportOrders);
router.post('/partner/orders', isAuth, checkRole('partner'), partnerCtrl.createOrder);

router.post('/station/scan', isAuth, checkRole('station_operator'), scanLimiter, stationCtrl.scan);
router.get('/station/vouchers', isAuth, checkRole('station_operator'), stationCtrl.lookup);
router.get('/station/report', isAuth, checkRole('station_operator'), stationCtrl.report);

const admin = express.Router();
admin.use(isAuth, requirePrivileged);
admin.get('/orders', checkRole('admin', 'agent'), adminCtrl.listOrders);
admin.get('/orders/:id', checkRole('admin', 'agent'), adminCtrl.getOrder);
admin.post('/orders/:id/cancel', checkRole('admin', 'agent'), adminCtrl.cancelOrder);
admin.post('/orders/:id/agency-payment', checkRole('admin', 'agent'), adminCtrl.agencyPayment);
admin.post('/orders/:id/handover', checkRole('admin', 'agent'), adminCtrl.handover);
admin.post('/vouchers/mark-used-offline', checkRole('admin'), adminCtrl.markOffline);
admin.get('/voucher-types', checkRole('admin'), adminCtrl.listVoucherTypes);
admin.post('/voucher-types', checkRole('admin'), adminCtrl.createVoucherType);
admin.patch('/voucher-types/:id', checkRole('admin'), adminCtrl.updateVoucherType);
admin.post('/voucher-types/:id/publish', checkRole('admin'), adminCtrl.publishVoucher);
admin.delete('/voucher-types/:id', checkRole('admin'), adminCtrl.deleteVoucher);
admin.post('/voucher-types/:id/photos', checkRole('admin'), upload.single('photo'), adminCtrl.photo);
admin.put('/availability', checkRole('admin'), adminCtrl.setAvailability);
admin.get('/price-grids', checkRole('admin'), adminCtrl.listPriceGrids);
admin.post('/price-grids', checkRole('admin'), adminCtrl.createPriceGrid);
admin.post('/price-grids/prices', checkRole('admin'), adminCtrl.setGridPrice);
admin.get('/promo-codes', checkRole('admin'), adminCtrl.listPromos);
admin.post('/promo-codes', checkRole('admin'), adminCtrl.createPromo);
admin.get('/partners', checkRole('admin'), adminCtrl.listPartners);
admin.post('/partners/:id/approval', checkRole('admin'), adminCtrl.approvePartner);
admin.post('/partners/:id/credit', checkRole('admin'), adminCtrl.setCredit);
admin.post('/partners/:id/payments', checkRole('admin'), adminCtrl.partnerPayment);
admin.get('/users', checkRole('admin'), adminCtrl.listUsers);
admin.post('/users', checkRole('admin'), adminCtrl.createUser);
admin.patch('/users/:id', checkRole('admin'), adminCtrl.updateUser);
admin.get('/stats', checkRole('admin'), adminCtrl.getStats);
admin.get('/audit', checkRole('admin'), adminCtrl.auditLog);
admin.get('/notifications', checkRole('admin'), adminCtrl.notifications);
admin.get('/settings', checkRole('admin'), adminCtrl.listSettings);
admin.put('/settings', checkRole('admin'), adminCtrl.updateSetting);
router.use('/admin', admin);

module.exports = router;
