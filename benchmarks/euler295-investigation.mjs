import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';
const [mode = 'compiled', variant = 'original', n = '100000'] = process.argv.slice(2);
assert(['compiled', 'reference'].includes(mode));
assert(/^[a-z]+$/.test(variant) && /^\d+$/.test(n));
const source = readFileSync(new URL(variant === 'shipping' ? '../demos/euler/295_lenticularholes.ra'
    : `./experiments/euler295-${variant}.ra`, import.meta.url), 'utf8')
    .replace('arg N integer = 100000', `arg N integer = ${n}`);
const runtime = new Interpreter(() => {}, {compilation: mode === 'compiled'});
const diagnostics = new RuntimeDiagnostics();
const start = performance.now();
try {
    const cuts = ['Cn = array shape Nf fill 0', 'Rr = array shape Tt fill 0', 'Od = Rr argsort',
        'Dist = 0', 'Jx = new index', 'Total = Dist'];
    const phases = [];
    if (process.env.PHASES) {
        let begin = 0;
        for (const marker of [...cuts, null]) {
            const end = marker === null ? source.length : source.indexOf(marker);
            assert(end > begin);
            const time = performance.now();
            diagnostics.run(() => runtime.execute(source.slice(begin, end)));
            phases.push({until: marker ?? 'end', ms: performance.now() - time});
            console.error(JSON.stringify(phases.at(-1)));
            begin = end;
        }
    } else diagnostics.run(() => runtime.execute(source));
    const answer = String(runtime.variables.get('Answer'));
    const expected = {10: '30', 100: '3442', 1000: '393451', 100000: '4884650818'}[n];
    if (expected) assert.equal(answer, expected);
    const counts = Object.fromEntries(['Nf', 'Tt', 'Dist', 'Ng', 'Pm', 'Nj'].map(name => [name, String(runtime.variables.get(name))]));
    console.log(JSON.stringify({mode, variant, n, answer, ms: performance.now() - start,
        rssMiB: process.resourceUsage().maxRSS / 1024, counts, phases, diagnostics}));
} finally {runtime.dispose();}
