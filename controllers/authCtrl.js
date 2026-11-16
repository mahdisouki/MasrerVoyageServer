const { asyncHandler } = require('../utils/asyncHandler');
const auth = require('../services/authService');

const register = asyncHandler(async (req, res) => {
  const data = await auth.register(req.body);
  res.status(201).json({ success: true, data });
});

const login = asyncHandler(async (req, res) => {
  const data = await auth.login(req.body);
  res.json({ success: true, data });
});

const setup2fa = asyncHandler(async (req, res) => {
  const data = await auth.setup2fa(req.user);
  res.json({ success: true, data });
});

const confirm2fa = asyncHandler(async (req, res) => {
  const data = await auth.confirm2fa(req.user, req.body.code);
  res.json({ success: true, data });
});

const verify2fa = asyncHandler(async (req, res) => {
  const data = await auth.verify2fa(req.user, req.body.code);
  res.json({ success: true, data });
});

const refresh = asyncHandler(async (req, res) => {
  const data = await auth.refresh(req.body.refreshToken);
  res.json({ success: true, data });
});

const logout = asyncHandler(async (req, res) => {
  await auth.logout(req.user);
  res.json({ success: true });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const data = await auth.forgotPassword(req.body.email);
  res.json(data);
});

const resetPassword = asyncHandler(async (req, res) => {
  const data = await auth.resetPassword(req.body);
  res.json(data);
});

module.exports = { register, login, setup2fa, confirm2fa, verify2fa, refresh, logout, forgotPassword, resetPassword };
