const crypto = require('crypto');
const { pickLocale } = require('../utils/locale');

function requestContext(req, res, next) {
  req.id = crypto.randomUUID();
  req.locale = pickLocale(req);
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = { requestContext };
