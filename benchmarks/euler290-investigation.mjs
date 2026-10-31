import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled', variant='original', n='18'] = process.argv.slice(2);
assert(['compiled', 'reference'].includes(mode));
assert(/^\d+$/.test(n) && /^[a-z]+$/.test(variant));
const source = readFileSync(new URL(variant === 'shipping' ? '../demos/euler/290_digitalsignature.ra' : `./experiments/euler290-${variant}.ra`, import.meta.url), 'utf8')
    .replace('arg N integer = 18', `arg N integer = ${n}`);
const runtime = new Interpreter(() => {}, {compilation: mode === 'compiled'});
const diagnostics = new RuntimeDiagnostics();
const start = performance.now();
try {
    if (process.env.DIAGNOSTICS) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    if (+n === 18) assert.equal(answer, '20444710234716473');
    if (+n === 6) assert.equal(answer, '27955');
    if (+n === 3) assert.equal(answer, '33');
    console.log(JSON.stringify({mode, variant, n: +n, ms: performance.now() - start, answer,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        ...(process.env.DIAGNOSTICS ? {diagnostics} : {})}));
} finally { runtime.dispose(); }
