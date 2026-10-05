import { readFileSync } from 'node:fs';

const paths = process.argv.slice(2);
if (paths.length !== 4) throw new Error(`Expected four type audit summaries, got ${paths.length}`);

const summaries = paths.map(path => JSON.parse(readFileSync(path, 'utf8')));
const shards = new Set(summaries.map(summary => summary.shard));
if ([0, 1, 2, 3].some(shard => !shards.has(shard)) || summaries.some(summary => summary.shardCount !== 4)) {
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
