const REQUIRED = [
  'JWT_SECRET',
  'REFRESH_SECRET',
  'QR_SECRET_V1',
  'PAYMENT_WEBHOOK_SECRET',
  'TOTP_ENCRYPTION_KEY',
  'STORAGE_DIR',
];

function assertEnv() {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing environment: ${missing.join(', ')}`);
  }
}

module.exports = { assertEnv, REQUIRED };
