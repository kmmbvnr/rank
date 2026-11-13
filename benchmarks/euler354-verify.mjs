import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { Interpreter } = await import(process.env.RUNTIME || new URL('../packages/interpreter/out/index.js', import.meta.url).href);
const root = fileURLToPath(new URL('..', import.meta.url));
const main = resolve(root, 'demos/euler/354_honeycomb.ra');
const fixture = resolve(root, 'demos/euler/354_honeycomb_test.ra');
let assertions = 0;
for (const compilation of [false, true]) {
    const runtime = new Interpreter(() => {}, {
        compilation, testing: true, sourceId: fixture,
        loadModule(specifier, from) {
            const id = resolve(dirname(from ?? fixture), specifier.endsWith('.ra') ? specifier : specifier + '.ra');
            return { id, source: readFileSync(id, 'utf8') };
        },
    });
    try {
        runtime.execute(readFileSync(fixture, 'utf8'));
        assert.equal(runtime.testResults.length, 1);
        assert(runtime.testResults.every(test => test.passed), JSON.stringify(runtime.testResults));
        assertions++;
    } finally { runtime.dispose(); }
    for (const [limit, answer] of [[0, 0n], [1, 0n], [100000, 0n], [1000000, 18n], [10000000, 597n], [500000000000, 58065134n]]) {
        const r = new Interpreter(() => {}, { compilation, args: [`--limit=${limit}`] });
        try {
            r.execute(readFileSync(main, 'utf8'));
            assert.equal((r.variables.get('Answer') ?? r.lastResult), answer, `${compilation}: ${limit}`);
            assertions++;
        } finally { r.dispose(); }
    }
}
console.log(JSON.stringify({ assertions, fixture: 'passed in both engines', fullAnswer: '58065134' }));
