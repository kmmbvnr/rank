import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';

const [mode = 'compiled', variant = 'original', n = '16'] = process.argv.slice(2);
assert(['compiled', 'reference'].includes(mode));
assert(['original', 'terminal', 'symmetric', 'corners', 'shipping'].includes(variant));
assert(/^\d+$/.test(n) && +n >= 1 && +n <= 24);
const source = readFileSync(new URL(variant === 'shipping' ? '../demos/euler/287_quadtree.ra' : `./experiments/euler287-${variant}.ra`, import.meta.url), 'utf8')
    .replace('arg N integer = 24', `arg N integer = ${n}`);
const runtime = new Interpreter(() => {}, {compilation: mode === 'compiled'});
const diagnostics = new RuntimeDiagnostics();
const start = performance.now();
try {
    if (process.env.DIAGNOSTICS) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start;
    const answer = String(runtime.variables.get('Answer'));
    const expected = {1: '9', 2: '30', 3: '86', 8: '4552', 12: '75658', 16: '1221292', 24: '313135496'}[n];
    if (expected) assert.equal(answer, expected);
    console.log(JSON.stringify({mode, variant, n: +n, ms, answer,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        ...(process.env.DIAGNOSTICS ? {diagnostics} : {})}));
} finally {
    runtime.dispose();
}
