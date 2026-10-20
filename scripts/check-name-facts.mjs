import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
const count = args[0] === '--shards' ? Number(args.splice(0, 2)[1]) : 4;
assert.ok(Number.isSafeInteger(count) && count > 0, 'invalid name facts shard count');
const summaries = args.map(file => JSON.parse(readFileSync(file, 'utf8')));
assert.deepEqual(summaries.map(result => result.shard).sort((a, b) => a - b), Array.from({ length: count }, (_, shard) => shard), 'all shards must report');
assert.ok(summaries.every(result => result.count === count), 'shard counts must agree');
const demos = resolve(import.meta.dirname, '../demos');
const exclusions = new Set(Object.keys(JSON.parse(readFileSync(new URL('./demo-execution-exclusions.json', import.meta.url), 'utf8'))));
function programs(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = resolve(directory, entry.name);
        return entry.isDirectory() ? programs(file) : file.endsWith('.ra') ? [relative(demos, file)] : [];
    });
}
assert.deepEqual(summaries.flatMap(result => result.files).sort(), programs(demos).filter(file => !exclusions.has(file)).sort(), 'every eligible demo must be audited exactly once');
const totals = summaries.reduce((sum, result) => ({ ran: sum.ran + result.ran,
    asked: sum.asked + result.asked, known: sum.known + result.known }), { ran: 0, asked: 0, known: 0 });
assert.ok(totals.ran > 100, 'successful execution coverage dropped');
assert.ok(totals.known > 50, 'name facts coverage dropped');
console.log('Name facts coverage:', totals);
