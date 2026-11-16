const { Job } = require('../models');

async function enqueue(session, jobs) {
  if (!jobs.length) return;
  const docs = jobs.map((job) => ({
    type: job.type,
    payload: job.payload,
    status: 'pending',
    runAt: job.runAt || new Date(),
    attempts: 0,
    maxAttempts: job.maxAttempts || 5,
  }));
  if (session) await Job.create(docs, { session, ordered: true });
  else await Job.create(docs);
}

module.exports = { enqueue };
