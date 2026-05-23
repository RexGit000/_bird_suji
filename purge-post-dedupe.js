import 'dotenv/config';
import { connectDB, PostDedupe } from './models/db.js';

function getArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const targetChatId = getArg('--target');
  const daysArg = getArg('--days');
  const days = daysArg ? Number(daysArg) : null;

  if (days != null && (!Number.isFinite(days) || days <= 0)) {
    console.error('Invalid --days value. Must be a positive number.');
    process.exit(1);
  }

  await connectDB();

  const filter = {};
  if (targetChatId) filter.targetChatId = targetChatId.toString();
  if (days != null) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    filter.createdAt = { $gte: since };
  }

  const total = await PostDedupe.countDocuments(filter);
  console.log(JSON.stringify({ dryRun: !apply, filter, matched: total }, null, 2));

  if (!apply) {
    console.log('Dry-run only. Re-run with --apply to delete.');
    process.exit(0);
  }

  const res = await PostDedupe.deleteMany(filter);
  console.log(JSON.stringify({ deleted: res.deletedCount ?? 0 }, null, 2));
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});

