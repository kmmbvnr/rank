import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const count = args[0] === '--shards' ? Number(args.splice(0, 2)[1]) : 4;
if (!Number.isSafeInteger(count) || count < 1) throw new Error('Invalid type audit shard count');
const paths = args;
if (paths.length !== count) throw new Error(`Expected ${count} type audit summaries, got ${paths.length}`);

const summaries = paths.map(path => JSON.parse(readFileSync(path, 'utf8')));
const shards = new Set(summaries.map(summary => summary.shard));
if (shards.size !== count || Array.from({ length: count }, (_, shard) => shard).some(shard => !shards.has(shard))
    || summaries.some(summary => summary.shardCount !== count)) {
    throw new Error('Type audit shards are incomplete');
}

const totals = summaries.reduce((sum, summary) => ({
    ran: sum.ran + summary.ran,
    names: sum.names + summary.names,
    settled: sum.settled + summary.settled,
}), { ran: 0, names: 0, settled: 0 });
console.log(`type audit: ${totals.ran} demos run, ${totals.names} names, ${totals.settled} settled`);
if (totals.ran <= 400 || totals.settled / totals.names <= 0.75) {
    throw new Error('Type audit coverage fell below the required level');
}
