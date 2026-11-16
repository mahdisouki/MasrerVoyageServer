const { AppError } = require('../utils/AppError');
const { errorBody } = require('../utils/messages');

function notFound(_req, _res, next) {
  next(new AppError(404, 'not_found', 'Not found'));
}

function errorHandler(err, req, res, _next) {
  const status = err.status || (err.code === 11000 ? 409 : 500);
  if (status >= 500) console.error(req.id, err);
  const body = errorBody(err, req.locale);
  if (process.env.NODE_ENV === 'development' && status >= 500 && err.message) {
    body.message = err.message;
  }
  res.status(status).json(body);
}

module.exports = { notFound, errorHandler };
