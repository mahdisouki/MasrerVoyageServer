const swaggerUi = require('swagger-ui-express');
const spec = require('./openapi');

function setupSwagger(app) {
  app.get('/api-docs.json', (_req, res) => {
    res.json(spec);
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(spec, {
    swaggerOptions: { persistAuthorization: true },
  }));
}

module.exports = setupSwagger;
