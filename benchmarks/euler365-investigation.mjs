import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';

const [variant = 'production', mode = 'compiled', hi = '5000'] = process.argv.slice(2);
const path = variant === 'production' || variant === 'partials'
    ? '../demos/euler/365_hugebinomial.ra' : './experiments/euler365-original.ra';
let source = readFileSync(new URL(path, import.meta.url), 'utf8');
if (variant === 'array') {
    const start = source.indexOf('      for L in');
    const end = source.indexOf('\n    end', start);
    source = source.slice(0, start) + `      L = J + 1 till M
      R = Ps L
      D = Rs L - X mod R + R
      U = Inv I L * Inv J L mod R
      U = D * U mod R
      Sum += (X + PQ * U) sum` + source.slice(end);
} else assert.ok(['original', 'partials', 'production'].includes(variant));
source = source.replace('  Inv = array', '  "residues" print\n  Inv = array')
    .replace('  Sum = 0', '  "inverses" print\n  Sum = 0')
    .replace('  Totals = array', '  "inverses" print\n  Totals = array');
const phases = [], diagnostics = new RuntimeDiagnostics();
let last, answer;
const runtime = new Interpreter(text => {
    const now = performance.now();
    phases.push({label: text, ms: now - last});
    last = now;
    answer = text;
}, {compilation: mode !== 'reference', args: ['--hi', hi]});
let session;
if (process.env.PROFILE) {
    session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.start');
}
const start = performance.now();
last = start;
try {
    if (process.env.DIAG) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    if (hi === '5000') assert.equal(answer, '162619462356610313');
    console.log(JSON.stringify({variant, mode, hi, answer, ms: performance.now() - start,
        rssMiB: process.resourceUsage().maxRSS / 1024, phases,
        ...(process.env.DIAG ? {diagnostics} : {})}));
    if (session) {
        const {profile} = await session.post('Profiler.stop');
        writeFileSync(process.env.PROFILE, JSON.stringify(profile));
    }
} finally {
    runtime.dispose();
    session?.disconnect();
}
