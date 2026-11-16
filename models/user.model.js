const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, required: true, enum: ['customer', 'partner', 'agent', 'admin', 'station_operator'] },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  phone: { type: String, default: '' },
  language: { type: String, enum: ['fr', 'ar', 'en'], default: 'fr' },
  status: { type: String, enum: ['active', 'disabled'], default: 'active' },
  refreshTokenHash: { type: String },
  totpSecret: { type: String },
  totpConfirmedAt: { type: Date },
  recoveryCodeHashes: [{ type: String }],
  passwordResetTokenHash: { type: String },
  passwordResetExpires: { type: Date },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

userSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.passwordHash;
    delete ret.totpSecret;
    delete ret.refreshTokenHash;
    delete ret.recoveryCodeHashes;
    delete ret.passwordResetTokenHash;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
