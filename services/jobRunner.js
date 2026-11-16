const { Job, Notification } = require('../models');

const handlers = {
  generate_pdf: (payload) => require('./pdfService').generateForOrder(payload),
  send_email: (payload) => require('./notificationService').sendEmail(payload),
  send_whatsapp: (payload) => require('./notificationService').sendWhatsApp(payload),
  visit_reminder: (payload) => require('./notificationService').sendEmail({ ...payload, template: 'visit_reminder' }),
};

async function processDueJobs() {
  const job = await Job.findOneAndUpdate(
    { status: 'pending', runAt: { $lte: new Date() } },
    { $set: { status: 'running' } },
    { sort: { runAt: 1 }, new: true },
  );
  if (!job) return;
  const handler = handlers[job.type];
  if (!handler) {
    job.status = 'failed';
    job.lastError = `Unknown job type ${job.type}`;
    await job.save();
    return;
  }
  try {
    await handler(job.payload);
    job.status = 'succeeded';
    job.lastError = undefined;
  } catch (err) {
    job.attempts += 1;
    job.lastError = err.message;
    if (job.attempts >= job.maxAttempts) {
      job.status = 'failed';
      await Notification.create({ type: 'job_failed', title: job.type, body: err.message, entity: 'job', entityId: job._id });
    } else {
      job.status = 'pending';
      job.runAt = new Date(Date.now() + (2 ** job.attempts) * 60 * 1000);
    }
  }
  await job.save();
}

module.exports = { processDueJobs };
