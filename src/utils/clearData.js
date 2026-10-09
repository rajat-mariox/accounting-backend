/*
 * Remove business data from the database.
 *
 *   npm run clear:data                      dry run: shows what would be deleted, deletes nothing
 *   npm run clear:data -- --confirm         delete business data, KEEP staff logins + settings + invoice counter
 *   npm run clear:data -- --confirm --everything
 *                                           delete EVERY collection, including all users, settings and
 *                                           the invoice number counter (you will need `npm run seed`
 *                                           or a new admin user to log in again)
 *   --allow-remote                          required when MONGO_URI is not a local database (e.g. Atlas)
 *
 * Default mode deletes: clients, client portal logins, suppliers, supply activities (incl. attached
 * invoice files), inventory items, warehouses, transfers, invoices, payments, notifications, audit logs,
 * and any other collection not listed in KEEP below.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const args = new Set(process.argv.slice(2));
const CONFIRM = args.has('--confirm');
const EVERYTHING = args.has('--everything');
const ALLOW_REMOTE = args.has('--allow-remote');

// Kept in default mode. `users` is handled separately: staff are kept, client portal logins removed.
// The invoice counter is kept so invoice numbers keep their never-resetting sequence.
const KEEP = new Set(['settings', 'counters']);

function describeTarget(uri) {
  try {
    const parsed = new URL(uri.replace(/^mongodb(\+srv)?:/, 'http:'));
    const db = parsed.pathname.replace(/^\//, '') || '(default)';
    return { host: parsed.host, db };
  } catch {
    return { host: '(unparsed)', db: '(unknown)' };
  }
}

function isLocal(uri) {
  if (/^mongodb\+srv:/.test(uri)) return false;
  const { host } = describeTarget(uri);
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI is not set in .env');
    process.exit(1);
  }

  const { host, db } = describeTarget(uri);
  console.log(`Target database: ${db} on ${host}`);
  console.log(`Mode: ${EVERYTHING ? 'EVERYTHING (all collections, all users)' : 'business data (keeps staff logins, settings, invoice counter)'}`);
  console.log(CONFIRM ? 'Running for real: data WILL be deleted.\n' : 'Dry run: nothing will be deleted. Add --confirm to delete.\n');

  if (!isLocal(uri) && !ALLOW_REMOTE) {
    console.error('Refusing: this is not a local database. Add --allow-remote if you really mean it.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const conn = mongoose.connection.db;
  const collections = (await conn.listCollections().toArray())
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'))
    .sort();

  const plan = [];
  for (const name of collections) {
    const col = conn.collection(name);
    const total = await col.countDocuments();
    if (EVERYTHING) {
      plan.push({ name, filter: {}, remove: total, keep: 0 });
    } else if (name === 'users') {
      const clientLogins = await col.countDocuments({ role: 'Client' });
      plan.push({ name, filter: { role: 'Client' }, remove: clientLogins, keep: total - clientLogins });
    } else if (KEEP.has(name)) {
      plan.push({ name, filter: null, remove: 0, keep: total });
    } else {
      plan.push({ name, filter: {}, remove: total, keep: 0 });
    }
  }

  console.table(plan.map(({ name, remove, keep }) => ({ collection: name, delete: remove, keep })));

  if (!CONFIRM) {
    console.log('\nDry run finished. Nothing was deleted.');
    await mongoose.disconnect();
    return;
  }

  let removed = 0;
  for (const step of plan) {
    if (!step.filter || step.remove === 0) continue;
    const result = await conn.collection(step.name).deleteMany(step.filter);
    removed += result.deletedCount;
    console.log(`Deleted ${result.deletedCount} from ${step.name}`);
  }
  console.log(`\nDone. ${removed} documents deleted.`);
  if (EVERYTHING) {
    console.log('All users were removed. Run `npm run seed` (or create an admin) before logging in.');
  } else {
    const staff = plan.find((p) => p.name === 'users')?.keep ?? 0;
    console.log(`${staff} staff login(s) kept. You can log in with the same accounts.`);
  }
  await mongoose.disconnect();
})().catch(async (err) => {
  console.error('Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
