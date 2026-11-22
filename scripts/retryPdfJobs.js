require('dotenv').config();
const mongoose = require('mongoose');
const Job = require('../models/job.model');
const IssuedVoucher = require('../models/issuedVoucher.model');
const { processDueJobs } = require('../services/jobRunner');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const updated = await Job.updateMany(
    { type: 'generate_pdf', status: { $in: ['pending', 'failed', 'running'] } },
    { $set: { status: 'pending', runAt: new Date(), attempts: 0, lastError: null } },
  );
  console.log('reset jobs', updated.modifiedCount);

  await processDueJobs();

  const vouchers = await IssuedVoucher.find().sort({ createdAt: -1 }).limit(5).lean();
  console.log(
    'vouchers',
    vouchers.map((v) => ({ publicId: v.publicId, pdfKey: v.pdfKey || null })),
  );

  const jobs = await Job.find({ type: 'generate_pdf' }).sort({ createdAt: -1 }).limit(5).lean();
  console.log(
    'jobs',
    jobs.map((j) => ({ status: j.status, attempts: j.attempts, lastError: j.lastError || null })),
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
