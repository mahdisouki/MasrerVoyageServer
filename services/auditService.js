const { ActivityLog } = require('../models');

async function audit({ userId, action, entity, entityId, meta, session }) {
  await ActivityLog.create([{
    userId,
    action,
    entity,
    entityId: entityId ? String(entityId) : undefined,
    meta,
    at: new Date(),
  }], { session });
}

module.exports = { audit };
