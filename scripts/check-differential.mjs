import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import assert from 'node:assert/strict';

const demos = resolve(import.meta.dirname, '../demos');
function programs(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = resolve(directory, entry.name);
        return entry.isDirectory() ? programs(file) : file.endsWith('.ra') ? [relative(demos, file)] : [];
    });
}
const executionExclusions = new Set(Object.keys(JSON.parse(readFileSync(
    new URL('./demo-execution-exclusions.json', import.meta.url), 'utf8'))));
const args = process.argv.slice(2);
const count = args[0] === '--shards' ? Number(args.splice(0, 2)[1]) : 4;
assert.ok(Number.isSafeInteger(count) && count > 0, 'invalid differential shard count');
const summaries = args.map(file => JSON.parse(readFileSync(file, 'utf8')));
assert.deepEqual(summaries.map(result => result.shard).sort((a, b) => a - b), Array.from({ length: count }, (_, shard) => shard), 'all shards must report');
assert.ok(summaries.every(result => result.count === count), 'shard counts must agree');
assert.deepEqual(summaries.flatMap(result => result.files).sort(), programs(demos).filter(file => !executionExclusions.has(file)).sort(),
    'every eligible demo and Rank test file must be compared exactly once');
const totals = summaries.reduce((sum, result) => ({ completed: sum.completed + result.completed,
    tests: sum.tests + result.tests, entries: sum.entries + result.entries,
    numberEntries: sum.numberEntries + result.numberEntries }), { completed: 0, tests: 0, entries: 0, numberEntries: 0 });
assert.ok(totals.completed > 400, 'successful execution coverage dropped');
assert.ok(totals.tests > 100, 'embedded Rank test coverage dropped');
assert.ok(totals.entries > 0, 'compiled runs must execute generated code');
assert.ok(totals.numberEntries > 0, 'compiled corpus must execute Number loops');
console.log('Differential coverage:', totals);
