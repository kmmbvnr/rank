import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';

const [mode = 'compiled', m = '3', n = m, variant = 'original'] = process.argv.slice(2);
const files = {
    shipping: 'shipping', original: 'original', swap: 'swap', keyswap: 'compact-key', hash: 'numeric-hash',
    prune: 'early-close', hashprune: 'numeric-hash-early-close',
};
assert(['compiled', 'reference'].includes(mode));
assert(Object.hasOwn(files, variant));
assert(/^\d+$/.test(m) && /^\d+$/.test(n));
const source = readFileSync(new URL(variant === 'shipping' ? '../demos/euler/289_eulerianloops.ra' : `./experiments/euler289-${files[variant]}.ra`, import.meta.url), 'utf8')
    .replace('arg M integer = 6', `arg M integer = ${m}`)
    .replace('arg N integer = 10', `arg N integer = ${n}`);
const runtime = new Interpreter(() => {}, {compilation: mode === 'compiled'});
const diagnostics = new RuntimeDiagnostics();
const start = performance.now();
try {
    if (process.env.DIAGNOSTICS) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    if (+m === 6 && +n === 10) assert.equal(answer, '6567944538');
    if (+m === 3 && +n === 3) assert.equal(answer, '104290');
    console.log(JSON.stringify({mode, m, n, variant, ms: performance.now() - start, answer,
        rss: process.resourceUsage().maxRSS / 1024,
        ...(process.env.DIAGNOSTICS ? {diagnostics} : {})}));
} finally { runtime.dispose(); }
