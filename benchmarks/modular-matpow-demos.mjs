import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Interpreter, RuntimeDiagnostics } from '../packages/interpreter/out/index.js';

const mode = process.argv[2] ?? 'after';
assert.ok(['before', 'after'].includes(mode));
const root = new URL('../', import.meta.url);
const load = path => mode === 'before'
    ? execFileSync('git', ['show', `3fbb64ec:${path}`], { cwd: root, encoding: 'utf8' })
    : readFileSync(new URL(path, root), 'utf8');
const functions = path => 'use linalg\nuse numbers\nuse sequences\n' + load(path).slice(load(path).indexOf('\nfun ') + 1);
let graphAnswer = 1n, b = 3n, e = 999999999999999999n;
for (; e; e >>= 1n, b = b * b % 1000000007n) if (e & 1n) graphAnswer = graphAnswer * b % 1000000007n;
const cases = [
    ['dice', functions('demos/cses/math/022_throwingdice.ra') + '\nAnswer = 1000000000000000000 dice_ways', 106021903n, 1],
    ['paths', functions('demos/cses/math/023_graphpaths1.ra')
        + '\nEdges = (array 1 1 1 2 1 3 2 1 2 2 2 3 3 1 3 2 3 3) reshape 9 2\nAnswer = 3 Edges 1000000000000000000 path_count', graphAnswer, 1],
    ['euler435', load('demos/euler/435_polynomialsfib.ra'), 252541322550n, 100],
];
for (const [name, source, expected, count] of cases) {
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    try {
        const start = performance.now();
        d.run(() => r.execute(source));
        const ms = performance.now() - start, answer = r.variables.get('Answer');
        assert.equal(answer, expected);
        assert.equal(d.modularMatrixPowers, mode === 'before' ? 0 : count);
        console.log(JSON.stringify({ mode, name, ms, answer: String(answer), fused: d.modularMatrixPowers }));
    } finally { r.dispose(); }
}
