require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoose = require('mongoose');
const { connect } = require('./config/db');
const { assertEnv } = require('./config/env');
const setupSwagger = require('./config/swagger');
const routes = require('./routes');
const webhooks = require('./routes/webhooks');
const { requestContext } = require('./middlewares/requestContext');
const { notFound, errorHandler } = require('./middlewares/errorHandler');

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://validator.swagger.io'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  const origin = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true;
  app.use(cors({ origin }));
  app.use(requestContext);
  app.use('/api/v1/webhooks', express.raw({ type: 'application/json', limit: '1mb' }), webhooks);
  app.use(express.json({ limit: '1mb' }));
  setupSwagger(app);
  app.get('/api/v1/health', (_req, res) => {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ success: false, code: 'db_unavailable', message: 'Database is not connected' });
    }
    return res.json({ success: true, data: { ok: true } });
  });
  app.use('/api/v1', routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

async function start() {
  assertEnv();
  await connect(process.env.MONGODB_URI);
  console.log(`Database connected successfully: ${mongoose.connection.host}/${mongoose.connection.name}`);
  await require('./services/settingsService').ensure();
  require('./cron/scheduler').start();
  const port = Number(process.env.PORT || 4000);
  app.listen(port, () => {
    console.log(`Master Voyage API listening on ${port}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { app, start };
