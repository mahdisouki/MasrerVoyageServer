require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { assertEnv } = require('../config/env');
const mongoose = require('mongoose');
const { connect } = require('../config/db');
const { Treatment, User } = require('../models');
const treatments = require('../services/treatmentService');
const { save } = require('../services/pdfService');

const FRONT_ROOT = path.resolve(__dirname, '../../Korbes_Front-End');
const LOCALES = ['fr', 'ar', 'en'];

/** Hardcoded catalogue from the old static front (src/data/treatments.ts). */
const CATALOGUE = [
  { slug: 'bain-individuel', category: 'baths', image: 'source.jpg', featured: true },
  { slug: 'douche-thermale', category: 'showers', image: 'kanassira.jpg', featured: true },
  { slug: 'massage-affusion', category: 'body', image: 'coucher.jpg', featured: true },
  { slug: 'enveloppement', category: 'body', image: 'falaise.jpg', featured: false },
  { slug: 'soin-visage', category: 'wellness', image: 'lune.jpg', featured: false },
  { slug: 'parcours-detente', category: 'wellness', image: 'sunset.jpg', featured: false },
  { slug: 'seance-relaxation', category: 'wellness', image: 'cotes.jpg', featured: false },
  { slug: 'decouverte-station', category: 'baths', image: 'rue-01.jpg', featured: false },
];

function loadLocaleItems(locale) {
  const file = path.join(FRONT_ROOT, 'src/i18n/locales', `${locale}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Locale file missing: ${file}`);
  }
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = json?.treatments?.items;
  if (!items || typeof items !== 'object') {
    throw new Error(`treatments.items missing in ${locale}.json`);
  }
  return items;
}

function packFromItem(item) {
  return {
    name: item.name || '',
    summary: item.summary || '',
    description: item.description || '',
    benefits: Array.isArray(item.benefits) ? item.benefits.join('\n') : String(item.benefits || ''),
    characteristics: Array.isArray(item.characteristics)
      ? item.characteristics.join('\n')
      : String(item.characteristics || ''),
    info: item.info || '',
  };
}

async function attachPhoto(treatmentId, imageFile, userId) {
  const source = path.join(FRONT_ROOT, 'public/images', imageFile);
  if (!fs.existsSync(source)) {
    console.warn(`  photo skipped (missing): ${imageFile}`);
    return;
  }
  const key = path.join('photos', `seed-${path.parse(imageFile).name}${path.extname(imageFile)}`);
  const buffer = fs.readFileSync(source);
  await save(key, buffer);
  const doc = await Treatment.findById(treatmentId);
  if (!doc) return;
  const normalized = key.replace(/\\/g, '/');
  const already = (doc.photos || []).some((entry) => String(entry).replace(/\\/g, '/') === normalized);
  if (already) return;
  await treatments.pushPhoto(String(treatmentId), key, userId);
}

async function seedTreatments() {
  assertEnv();
  await connect(process.env.MONGODB_URI);

  const admin =
    (await User.findOne({ role: 'admin', status: { $ne: 'disabled' } })) ||
    (await User.findOne({ role: 'admin' }));
  if (!admin) {
    throw new Error('No admin user found. Run npm run seed first.');
  }
  const userId = admin._id;

  const localeItems = Object.fromEntries(LOCALES.map((locale) => [locale, loadLocaleItems(locale)]));

  let created = 0;
  let updated = 0;
  let published = 0;

  for (const entry of CATALOGUE) {
    const frItem = localeItems.fr[entry.slug];
    if (!frItem?.name) {
      console.warn(`Skip ${entry.slug}: missing French copy`);
      continue;
    }

    const translationPack = {};
    for (const locale of LOCALES) {
      const item = localeItems[locale]?.[entry.slug];
      if (item?.name) translationPack[locale] = packFromItem(item);
    }

    const body = {
      slug: entry.slug,
      category: entry.category,
      duration: frItem.duration || 'Sur demande',
      publicPrice: null,
      featured: Boolean(entry.featured),
      translations: translationPack,
    };

    let doc = await Treatment.findOne({ slug: entry.slug, deletedAt: null });
    if (!doc) {
      doc = await treatments.createTreatment({ body, userId });
      created += 1;
      console.log(`Created ${entry.slug}`);
    } else {
      await treatments.updateTreatment(String(doc._id), body, userId);
      updated += 1;
      console.log(`Updated ${entry.slug}`);
    }

    if (doc.status !== 'published') {
      await treatments.publish(String(doc._id), userId);
      published += 1;
    }

    if (!doc.photos?.length) {
      await attachPhoto(doc._id, entry.image, userId);
    }
  }

  console.log(`Done. created=${created} updated=${updated} published=${published}`);
  await mongoose.disconnect();
}

seedTreatments().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
