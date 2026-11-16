const { asyncHandler } = require('../utils/asyncHandler');
const station = require('../services/stationService');

const scan = asyncHandler(async (req, res) => {
  const result = await station.scan({
    token: req.body.token,
    number: req.body.number,
    operator: req.user,
    deviceId: req.get('X-Device-Id'),
    clientTimestamp: req.body.clientTimestamp,
  });
  res.status(result.status).json(result.body);
});

const lookup = asyncHandler(async (req, res) => {
  const data = await station.lookup(req.query.number, req.user, req.get('X-Device-Id'));
  res.json({ success: true, data });
});

const report = asyncHandler(async (req, res) => {
  const data = await station.report(req.query.date);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.send(station.reportCsv(data));
    return;
  }
  res.json({ success: true, data });
});

module.exports = { scan, lookup, report };
