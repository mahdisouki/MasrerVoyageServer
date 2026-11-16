const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { AppError } = require('../utils/AppError');

function storageDir() {
  if (!process.env.STORAGE_DIR) throw new AppError(500, 'storage_not_configured', 'STORAGE_DIR is required');
  return process.env.STORAGE_DIR;
}

const upload = multer({
  storage: multer.diskStorage({
    destination(_req, _file, cb) {
      const dir = path.join(storageDir(), 'incoming');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.\-]+/g, '_')}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter(_req, file, cb) {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowed.includes(file.mimetype)) {
      cb(new AppError(422, 'validation_error', 'Unsupported file type', [{ field: 'documents' }]));
      return;
    }
    cb(null, true);
  },
});

module.exports = { upload };
