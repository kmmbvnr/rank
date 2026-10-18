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
// Keep in step with packages/interpreter/test/differential.test.ts.
const tooSlow = /^euler\/(149|150|154|155|165|170|177|179|181|185|186|193|195|196|198)_/;
const summaries = process.argv.slice(2).map(file => JSON.parse(readFileSync(file, 'utf8')));
assert.deepEqual(summaries.map(result => result.shard).sort(), [0, 1, 2, 3], 'all four shards must report');
assert.ok(summaries.every(result => result.count === 4), 'shard counts must agree');
assert.deepEqual(summaries.flatMap(result => result.files).sort(), programs(demos).filter(file => !tooSlow.test(file)).sort(),
    'every demo and Rank test file must be compared exactly once');
const totals = summaries.reduce((sum, result) => ({ completed: sum.completed + result.completed,
    tests: sum.tests + result.tests, entries: sum.entries + result.entries }), { completed: 0, tests: 0, entries: 0 });
assert.ok(totals.completed > 400, 'successful execution coverage dropped');
assert.ok(totals.tests > 100, 'embedded Rank test coverage dropped');
assert.ok(totals.entries > 0, 'compiled runs must execute generated code');
console.log('Differential coverage:', totals);
