const rateLimit = require('express-rate-limit');
const { translate } = require('../utils/messages');

function limiter({ windowMs, limit }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler(req, res) {
      res.status(429).json({
        success: false,
        code: 'rate_limited',
        message: translate('rate_limited', req.locale, 'Too many attempts'),
      });
    },
  });
}

const loginLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 20 });
const registerLimiter = limiter({ windowMs: 60 * 60 * 1000, limit: 20 });
const guestAccessLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 10 });
const scanLimiter = limiter({ windowMs: 60 * 1000, limit: 60 });

module.exports = { loginLimiter, registerLimiter, guestAccessLimiter, scanLimiter };
