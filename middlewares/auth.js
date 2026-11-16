const jwt = require('jsonwebtoken');
const { User } = require('../models');
const { AppError } = require('../utils/AppError');

async function loadAccess(req, purpose) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new AppError(401, 'unauthenticated', 'Not logged in');
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    if (err.name === 'TokenExpiredError') throw new AppError(401, 'unauthenticated', 'Session expired');
    throw new AppError(401, 'unauthenticated', 'Not logged in');
  }
  if (decoded.purpose !== purpose) throw new AppError(401, 'unauthenticated', 'Not logged in');
  const user = await User.findById(decoded.userId);
  if (!user || user.deletedAt || user.status !== 'active') {
    throw new AppError(401, 'unauthenticated', 'Not logged in');
  }
  return { user, decoded };
}

async function isAuth(req, _res, next) {
  try {
    const { user, decoded } = await loadAccess(req, 'access');
    req.user = user;
    req.auth = decoded;
    next();
  } catch (err) {
    next(err);
  }
}

function purposeAuth(purpose) {
  return async (req, _res, next) => {
    try {
      const { user, decoded } = await loadAccess(req, purpose);
      req.user = user;
      req.auth = decoded;
      next();
    } catch (err) {
      next(err);
    }
  };
}

async function optionalAuth(req, _res, next) {
  if (!req.headers.authorization) return next();
  try {
    const { user, decoded } = await loadAccess(req, 'access');
    if (user.role === 'station_operator') throw new AppError(403, 'forbidden', 'Forbidden');
    req.user = user;
    req.auth = decoded;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { isAuth, purposeAuth, optionalAuth };
