// Fresh-process parse + execute timing. Build before running.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {resolve} from 'node:path';
if (process.env.EARLY_GUARD) await import(process.env.EARLY_GUARD === 'static'
    ? './experiments/euler393-disabled-entry.mjs' : './experiments/euler393-entry-guard.mjs');
if (process.env.ENTRY_CONTROL) await import('./experiments/euler393-entry-control.mjs');
const {Interpreter, RuntimeDiagnostics} = await import('../packages/interpreter/out/index.js');
const [n = '10', mode = 'compiled', file = 'demos/euler/393_ants.ra'] = process.argv.slice(2);
const expected = new Map([[0,1n],[1,0n],[2,2n],[3,0n],[4,88n],[5,0n],
    [6,207408n],[8,22902801416n],[10,112398351350823112n]]);
const runtime = new Interpreter(() => {}, {compilation: mode !== 'reference', args: [`--n=${n}`]});
const diagnostics = new RuntimeDiagnostics();
let session;
try {
    if (process.env.PROFILE) {
        session = new Session(); session.connect();
        await session.post('Profiler.enable'); await session.post('Profiler.start');
    }
    const source = readFileSync(resolve(file), 'utf8'), start = performance.now();
    const execute = () => runtime.execute(source);
    if (process.env.DIAG) diagnostics.run(execute); else execute();
    const ms = performance.now() - start, answer = runtime.variables.get('Answer');
    if (expected.has(Number(n))) assert.equal(answer, expected.get(Number(n)));
    if (session) {
        const {profile} = await session.post('Profiler.stop');
        writeFileSync(process.env.PROFILE, JSON.stringify(profile));
    }
    const cache = runtime.variables.get('Cache');
    const transitions = [...cache.entries.values()].reduce((total, out) => total + out.entries.size, 0);
    console.log(JSON.stringify({n: Number(n), mode, file, earlyGuard: process.env.EARLY_GUARD || false, entryControl: !!process.env.ENTRY_CONTROL,
        ms, rssMiB: process.resourceUsage().maxRSS / 1024, answer: String(answer),
        cachedProfiles: cache.entries.size, cachedTransitions: transitions,
        ...(process.env.DIAG ? {diagnostics} : {})}));
} finally {session?.disconnect(); runtime.dispose();}
