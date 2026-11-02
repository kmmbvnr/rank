// Research only: production demo is unchanged.
// node benchmarks/euler333-refresh.mjs [original|ranged|inplace|verify] [compiled|reference] [limit] [diag]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Disable only this delivery's admission proof in a fresh process; no runtime
// option or production module mutation is needed for the before/after control.
if (process.env.ENTRY_WORK === '0') {
    const { registerHooks } = await import('node:module');
    registerHooks({ load(url, context, nextLoad) {
        const loaded = nextLoad(url, context);
        if (!url.endsWith('/jit/number-loop-runtime.js')) return loaded;
        const source = String(loaded.source);
        const needle = 'const entryWork = prepareLoopEntryWork(plan, host);';
        assert(source.includes(needle), 'entry proof control must match exactly');
        return { ...loaded, source: source.replace(needle, 'const entryWork = undefined;') };
    } });
}
const { Interpreter, RuntimeDiagnostics, isRankArray } = await import('../packages/interpreter/out/index.js');

const read = name => readFileSync(new URL(`experiments/euler333-${name}.ra`, import.meta.url), 'utf8');
const source = read('layered');
const programs = {
    original: source.slice(0, source.indexOf('arg Limit')) + source.slice(source.indexOf('fun Limit solve')),
    inplace: read('conditional'),
    ranged: read('inplace'),
    production: (() => {
        const actual = readFileSync(new URL('../demos/euler/333_specialpartitions.ra', import.meta.url), 'utf8');
        return actual.slice(0, actual.indexOf('arg Limit')) + actual.slice(actual.indexOf('fun Limit solve'));
    })(),
};
const [name = 'original', mode = 'compiled', limit = '1000000', diagnostic] = process.argv.slice(2);
if (name === 'verify') {
    for (const compilation of [false, true]) {
        const before = new Interpreter(() => {}, { compilation });
        const after = new Interpreter(() => {}, { compilation });
        let checks = 0;
        try {
            before.execute(programs.original);
            after.execute(programs.production);
            const limits = [...Array.from({ length: 130 }, (_, i) => i),
                243, 244, 729, 730, 1000, 10000, ...(compilation ? [1000000] : [])];
            for (const n of limits) {
                const old = before.execute(`${n} partitioncounts`);
                const next = after.execute(`${n} partitioncounts`);
                assert(isRankArray(old) && isRankArray(next));
                assert.deepEqual(next.shape, old.shape);
                for (let i = 0; i < n; i++) {
                    assert.equal(next.items[i], old.items[i], `${compilation}/${n}/${i}`);
                    checks++;
                }
            }
            console.log(JSON.stringify({ compilation, checks, failures: 0 }));
        } finally {
            before.dispose();
            after.dispose();
        }
    }
 } else if (['demo185', 'demo331'].includes(name)) {
    const file = name === 'demo185' ? '185_numbermind' : '331_crossflips';
    const outputs = [];
    const runtime = new Interpreter(output => outputs.push(output.trim()));
    try {
        const source = readFileSync(new URL(`../demos/euler/${file}.ra`, import.meta.url), 'utf8');
        const start = performance.now();
        runtime.execute(source);
        const answer = outputs.at(-1);
        assert.equal(answer, name === 'demo185' ? '4640261571849533' : '467178235146843549');
        console.log(JSON.stringify({ name, mode: 'compiled', node: process.version,
            ms: performance.now() - start, rss: process.resourceUsage().maxRSS / 1024,
            answer, entryWork: process.env.ENTRY_WORK !== '0' }));
    } finally { runtime.dispose(); }
} else {
    assert(name in programs && ['compiled', 'reference'].includes(mode));
    assert(/^\d+$/.test(limit));
    const runtime = new Interpreter(() => {}, { compilation: mode === 'compiled' });
    const diagnostics = new RuntimeDiagnostics();
    try {
        runtime.execute(programs[name]);
        const start = performance.now();
        const execute = () => runtime.execute(`${limit} solve`);
        const answer = diagnostic ? diagnostics.run(execute) : execute();
        console.log(JSON.stringify({ name, mode, n: limit, node: process.version,
            ms: performance.now() - start, rss: process.resourceUsage().maxRSS / 1024,
            answer: String(answer), entryWork: process.env.ENTRY_WORK !== '0', ...(diagnostic ? { diagnostics } : {}) }));
    } finally {
        runtime.dispose();
    }
}
