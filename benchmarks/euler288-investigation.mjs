import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode='compiled', variant='original', q='10000000', p='61', exp='10'] = process.argv.slice(2);
assert(['compiled', 'reference'].includes(mode));
assert(['original', 'split', 'reduced', 'shipping'].includes(variant));
for (const value of [q, p, exp]) assert(/^\d+$/.test(value));
const source = readFileSync(new URL(variant === 'shipping' ? '../demos/euler/288_enormousfactorial.ra' : `./experiments/euler288-${variant}.ra`, import.meta.url), 'utf8')
    .replace('arg Q integer = 10000000', `arg Q integer = ${q}`)
    .replace('arg P integer = 61', `arg P integer = ${p}`)
    .replace('arg Exp integer = 10', `arg Exp integer = ${exp}`);
const runtime = new Interpreter(() => {}, {compilation: mode === 'compiled'});
const diagnostics = new RuntimeDiagnostics();
const start = performance.now();
try {
    if (process.env.DIAGNOSTICS) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const ms = performance.now() - start;
    const answer = String(runtime.variables.get('Answer'));
    if (+p === 61 && +q === 10000000 && +exp === 10) assert.equal(answer, '605857431263981935');
    if (+p === 3 && +q === 10000 && +exp === 20) assert.equal(answer, '624955285');
    console.log(JSON.stringify({mode, variant, p: +p, q: +q, exp: +exp, ms, answer,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        ...(process.env.DIAGNOSTICS ? {diagnostics} : {})}));
} finally { runtime.dispose(); }
