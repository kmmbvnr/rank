import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {Interpreter, RuntimeDiagnostics, control, assertPatched} from './euler374-runtime.mjs';

const [variant = 'production', mode = 'compiled', limit = '100000000000000'] = process.argv.slice(2);
let source = readFileSync(new URL(variant === 'production' ? '../demos/euler/374_partproduct.ra' : `./experiments/euler374-${variant}.ra`, import.meta.url), 'utf8');
source = source.replace(/Answer = (?:1|Limit min 1)/, match => `"${['production', 'recurrence'].includes(variant) ? 'setup' : 'inverses'}" print\n${match}`);
const phases = [], diagnostics = new RuntimeDiagnostics();
let last, answer;
const runtime = new Interpreter(text => {
    const now = performance.now();
    phases.push({label: text, ms: now - last});
    last = now;
    answer = text;
}, {compilation: mode !== 'reference', args: ['--limit', limit]});
let session;
if (process.env.PROFILE) {
    session = new Session(); session.connect();
    await session.post('Profiler.enable'); await session.post('Profiler.start');
}
const start = performance.now(); last = start;
try {
    if (process.env.DIAG) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    const expected = {'5': '22', '10': '254', '100': '611162873', '100000000000000': '334420941'}[limit];
    if (expected) assert.equal(answer, expected);
    assertPatched();
    console.log(JSON.stringify({variant, mode, limit, control, answer, ms: performance.now() - start,
        rssMiB: process.resourceUsage().maxRSS / 1024, phases,
        ...(process.env.DIAG ? {diagnostics} : {})}));
    if (session) { const {profile} = await session.post('Profiler.stop'); writeFileSync(process.env.PROFILE, JSON.stringify(profile)); }
} finally { runtime.dispose(); session?.disconnect(); }
