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
const tooSlow = new RegExp('^euler/(?:' + [
    '150_subtriangle(?:_default_test)?',
    '154_pascalpyramid',
    '155_capacitors',
    '165_intersections',
    '170_pandigitalproducts(?:_test)?',
    '177_quadrilaterals(?:_test)?',
    '179_consecutivedivisors',
    '185_numbermind(?:_test)?',
    '186_connectedness(?:_test)?',
    '193_squarefree',
    '196_primetriplets(?:_test)?',
    '198_ambiguous(?:_test)?',
].join('|') + ')\\.ra$');
const summaries = process.argv.slice(2).map(file => JSON.parse(readFileSync(file, 'utf8')));
assert.deepEqual(summaries.map(result => result.shard).sort(), [0, 1, 2, 3], 'all four shards must report');
assert.ok(summaries.every(result => result.count === 4), 'shard counts must agree');
assert.deepEqual(summaries.flatMap(result => result.files).sort(), programs(demos).filter(file => !tooSlow.test(file)).sort(),
    'every demo and Rank test file must be compared exactly once');
const totals = summaries.reduce((sum, result) => ({ completed: sum.completed + result.completed,
    tests: sum.tests + result.tests, entries: sum.entries + result.entries,
    numberEntries: sum.numberEntries + result.numberEntries }), { completed: 0, tests: 0, entries: 0, numberEntries: 0 });
assert.ok(totals.completed > 400, 'successful execution coverage dropped');
assert.ok(totals.tests > 100, 'embedded Rank test coverage dropped');
assert.ok(totals.entries > 0, 'compiled runs must execute generated code');
assert.ok(totals.numberEntries > 0, 'compiled corpus must execute Number loops');
console.log('Differential coverage:', totals);
