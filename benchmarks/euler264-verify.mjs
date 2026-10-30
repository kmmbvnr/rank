import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { oracle } from './euler264-oracle.mjs';

const { Interpreter } = await import(pathToFileURL(
    process.env.RUNTIME ?? process.cwd() + '/packages/interpreter/out/index.js'));
const original = readFileSync(new URL('./experiments/euler264-original.ra', import.meta.url), 'utf8');
const shipping = readFileSync(new URL('../demos/euler/264_trianglecentres.ra', import.meta.url), 'utf8');
const variants = ['original', 'gcd-circle', 'gcd-positive', 'gcd-circle-positive', 'shipping'];

for (const limit of [20, 30, 50, 75, 100, 150, 300, 1000]) {
    const expected = oracle(limit);
    for (const variant of variants) for (const compilation of [false, true]) {
        let source = variant === 'shipping' ? shipping : original;
        if (variant.includes('gcd')) source = source.replace(
            /    G1 = X abs[\s\S]*?    if G1 not equal 1/,
            '    G1 = X gcd Y\n    if G1 not equal 1');
        if (variant.includes('circle')) source = source.replace(
            '  for Y in (0 - Lm) to Lm',
            '  Ym = (Qm - X * X) max 0\n  Ym = Ym isqrt\n  for Y in (0 - Ym) to Ym');
        if (variant.includes('positive')) source = source.replace(
            'for X in (0 - Lm) to Lm', 'for X in 1 to Lm');
        source = source.replace('arg Limit integer = 100000', `arg Limit integer = ${limit}`);
        const runtime = new Interpreter(() => {}, { compilation });
        const context = JSON.stringify({ limit, variant, compilation });
        try {
            runtime.execute(source);
            assert.equal(Number(runtime.variables.get('Answer')), expected.answer, context);
            const columns = ['Ca', 'Cb', 'Cc', 'Cd', 'Ce', 'Cf'].map(name => runtime.variables.get(name).items);
            const actual = [];
            for (let i = 0; i < Number(runtime.variables.get('Nc')); i++) {
                const [ax, ay, bx, by, cx, cy] = columns.map(column => Number(column[i]));
                const perimeter = Math.hypot(ax - bx, ay - by) + Math.hypot(ax - cx, ay - cy)
                    + Math.hypot(bx - cx, by - cy);
                if (perimeter <= limit) actual.push([[ax, ay], [bx, by], [cx, cy]]
                    .map(point => point.join(',')).sort().join(';'));
            }
            assert.deepEqual(actual.sort(), expected.keys, context);
        } finally { runtime.dispose(); }
    }
    console.log(JSON.stringify({ limit, answer: expected.answer, count: expected.count, passed: variants.length * 2 }));
}
