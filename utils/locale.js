const { LOCALES } = require('../config/constants');

function pickLocale(req) {
  const header = String(req.headers['accept-language'] || '').slice(0, 2).toLowerCase();
  if (LOCALES.includes(header)) return header;
  return 'fr';
}

module.exports = { pickLocale };
