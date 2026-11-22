const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const { User } = require('../models');
const { AppError } = require('../utils/AppError');
const { sha256, randomCode } = require('../utils/money');
const { encrypt, decrypt } = require('../utils/secrets');
const { audit } = require('./auditService');
const { enqueue } = require('./jobQueue');
const { LOCALES } = require('../config/constants');

const MANAGED_ROLES = ['customer', 'agent', 'admin', 'station_operator'];

function rounds() {
  return process.env.NODE_ENV === 'test' ? 4 : 12;
}

function assertEmail(email) {
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(422, 'validation_error', 'Invalid email', [{ field: 'email' }]);
  }
  return email.toLowerCase().trim();
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new AppError(422, 'validation_error', 'Password must be at least 8 characters', [{ field: 'password' }]);
  }
}

function publicUser(user) {
  return {
    id: user._id,
    email: user.email,
    role: user.role,
    language: user.language,
    firstName: user.firstName,
    lastName: user.lastName,
    status: user.status || 'active',
  };
}

function signAccess(user, amr) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role, amr, purpose: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' },
  );
}

function signPurpose(user, purpose) {
  return jwt.sign(
    { userId: user._id.toString(), role: user.role, purpose },
    process.env.JWT_SECRET,
    { expiresIn: '10m' },
  );
}

async function issueSession(user, amr) {
  const accessToken = signAccess(user, amr);
  const refreshToken = jwt.sign(
    { userId: user._id.toString(), purpose: 'refresh' },
    process.env.REFRESH_SECRET,
    { expiresIn: '7d' },
  );
  user.refreshTokenHash = sha256(refreshToken);
  user.save && await user.save();
  return { accessToken, refreshToken, user: publicUser(user) };
}

async function register(body) {
  const email = assertEmail(body.email);
  assertPassword(body.password);
  const language = LOCALES.includes(body.language) ? body.language : 'fr';
  const passwordHash = await bcrypt.hash(body.password, rounds());
  try {
    const user = await User.create({
      email,
      passwordHash,
      role: 'customer',
      firstName: body.firstName || '',
      lastName: body.lastName || '',
      phone: body.phone || '',
      language,
    });
    return issueSession(user, 'pwd');
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'duplicate', 'Email is already registered', [{ field: 'email' }]);
    throw err;
  }
}

async function login({ email, password }) {
  const normalized = assertEmail(email);
  const user = await User.findOne({ email: normalized, deletedAt: null });
  const matches = user ? await bcrypt.compare(password || '', user.passwordHash) : false;
  if (!user || user.status !== 'active' || !matches) {
    throw new AppError(401, 'unauthenticated', 'Invalid email or password');
  }
  user.lastLoginAt = new Date();
  return issueSession(user, 'pwd');
}

async function setup2fa(user) {
  if (!['admin', 'agent'].includes(user.role)) throw new AppError(403, 'forbidden', 'Forbidden');
  if (user.totpConfirmedAt) throw new AppError(409, 'duplicate', 'Two-factor authentication is already confirmed');
  const secret = speakeasy.generateSecret({ length: 20, name: `Master Voyage (${user.email})` });
  user.totpSecret = encrypt(secret.base32);
  await user.save();
  return { otpauthUrl: secret.otpauth_url, secret: secret.base32 };
}

function verifyTotp(user, token) {
  if (!user.totpSecret) throw new AppError(422, 'validation_error', 'Two-factor setup is required');
  const secret = decrypt(user.totpSecret);
  const ok = speakeasy.totp.verify({ secret, encoding: 'base32', token: String(token || ''), window: 1 });
  if (!ok) throw new AppError(401, 'unauthenticated', 'Invalid authentication code');
}

async function confirm2fa(user, token) {
  verifyTotp(user, token);
  const codes = Array.from({ length: 8 }, () => randomCode('', 4));
  user.recoveryCodeHashes = codes.map((code) => sha256(code));
  user.totpConfirmedAt = new Date();
  const session = await issueSession(user, 'totp');
  return { ...session, recoveryCodes: codes };
}

async function verify2fa(user, token) {
  verifyTotp(user, token);
  return issueSession(user, 'totp');
}

async function refresh(refreshToken) {
  if (!refreshToken) throw new AppError(401, 'unauthenticated', 'Refresh token required');
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
  } catch {
    throw new AppError(403, 'unauthenticated', 'Invalid refresh token');
  }
  if (decoded.purpose !== 'refresh') throw new AppError(403, 'unauthenticated', 'Invalid refresh token');
  const user = await User.findById(decoded.userId);
  if (!user || user.deletedAt || user.status !== 'active' || user.refreshTokenHash !== sha256(refreshToken)) {
    throw new AppError(403, 'unauthenticated', 'Invalid refresh token');
  }
  return issueSession(user, 'pwd');
}

async function logout(user) {
  user.refreshTokenHash = undefined;
  await user.save();
}

async function forgotPassword(email) {
  const normalized = typeof email === 'string' ? email.toLowerCase().trim() : '';
  const user = await User.findOne({ email: normalized, deletedAt: null, status: 'active' });
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    user.passwordResetTokenHash = sha256(token);
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();
    await enqueue(null, [{
      type: 'send_email',
      payload: { template: 'password_reset', userId: user._id.toString(), token, locale: user.language },
    }]);
  }
  return { success: true, message: 'If the account exists, an email was sent' };
}

async function resetPassword({ token, password }) {
  assertPassword(password);
  const user = await User.findOne({
    passwordResetTokenHash: sha256(token || ''),
    passwordResetExpires: { $gt: new Date() },
  });
  if (!user) throw new AppError(400, 'validation_error', 'Reset token is invalid');
  user.passwordHash = await bcrypt.hash(password, rounds());
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpires = undefined;
  user.refreshTokenHash = undefined;
  await user.save();
  return { success: true };
}

async function createStaff(body, actorId) {
  const email = assertEmail(body.email);
  assertPassword(body.password);
  if (!MANAGED_ROLES.includes(body.role)) {
    throw new AppError(422, 'role_not_allowed', 'This role cannot be assigned here', [{ field: 'role' }]);
  }
  try {
    const user = await User.create({
      email,
      passwordHash: await bcrypt.hash(body.password, rounds()),
      role: body.role,
      firstName: body.firstName || '',
      lastName: body.lastName || '',
      language: LOCALES.includes(body.language) ? body.language : 'fr',
    });
    await audit({ userId: actorId, action: 'user.create', entity: 'user', entityId: user._id, meta: { role: user.role } });
    return publicUser(user);
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'duplicate', 'Email is already registered', [{ field: 'email' }]);
    throw err;
  }
}

async function updateUser(id, body, actorId) {
  const user = await User.findOne({ _id: id, deletedAt: null });
  if (!user) throw new AppError(404, 'not_found', 'Not found');
  if (body.status !== undefined && !['active', 'disabled'].includes(body.status)) {
    throw new AppError(422, 'validation_error', 'Invalid status', [{ field: 'status' }]);
  }
  if (body.role !== undefined) {
    if (!MANAGED_ROLES.includes(body.role) || user.role === 'partner') {
      throw new AppError(422, 'role_not_allowed', 'This role cannot be assigned here', [{ field: 'role' }]);
    }
  }
  const nextStatus = body.status ?? user.status;
  const nextRole = body.role ?? user.role;
  if (String(user._id) === String(actorId) && nextStatus === 'disabled') {
    throw new AppError(409, 'cannot_disable_self', 'You cannot disable your own account');
  }
  const removingActiveAdmin = user.role === 'admin' && user.status === 'active'
    && (nextRole !== 'admin' || nextStatus !== 'active');
  if (removingActiveAdmin) {
    const others = await User.countDocuments({
      _id: { $ne: user._id },
      role: 'admin',
      status: 'active',
      deletedAt: null,
    });
    if (others === 0) {
      throw new AppError(409, 'last_admin', 'The last administrator cannot be removed');
    }
  }
  if (body.status) user.status = body.status;
  if (body.role) user.role = body.role;
  await user.save();
  await audit({ userId: actorId, action: 'user.update', entity: 'user', entityId: user._id, meta: { role: user.role, status: user.status } });
  return publicUser(user);
}

async function listUsers() {
  const users = await User.find({ deletedAt: null }).sort({ createdAt: -1 });
  return users.map(publicUser);
}

module.exports = {
  register, login, setup2fa, confirm2fa, verify2fa, refresh, logout,
  forgotPassword, resetPassword, createStaff, updateUser, listUsers, publicUser, assertEmail,
};
