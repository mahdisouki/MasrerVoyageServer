function todayTunis(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function assertIsoDate(value, field) {
  const { AppError } = require('./AppError');
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(422, 'validation_error', 'Invalid date', [{ field }]);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new AppError(422, 'validation_error', 'Invalid date', [{ field }]);
  }
  return value;
}

function tunisLocalToUtc(isoDate, hour, minute) {
  const [year, month, day] = isoDate.split('-').map(Number);
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
  const actual = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(utc + (wanted - actual));
}

module.exports = { todayTunis, addDays, assertIsoDate, tunisLocalToUtc };
