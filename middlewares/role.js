const { AppError } = require('../utils/AppError');

function checkRole(...roles) {
  const allowed = roles.flat();
  return (req, _res, next) => {
    if (!req.user) return next(new AppError(401, 'unauthenticated', 'Not logged in'));
    if (!allowed.includes(req.user.role)) return next(new AppError(403, 'forbidden', 'Forbidden'));
    next();
  };
}

function requirePrivileged(req, _res, next) {
  if (!req.user) return next(new AppError(401, 'unauthenticated', 'Not logged in'));
  if (['admin', 'agent'].includes(req.user.role)) {
    if (req.auth?.amr !== 'totp' || !req.user.totpConfirmedAt) {
      return next(new AppError(403, 'forbidden', 'Two-factor authentication required'));
    }
  }
  next();
}

module.exports = { checkRole, requirePrivileged };
