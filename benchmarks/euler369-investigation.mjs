import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {Session} from 'node:inspector/promises';
import {Interpreter, RuntimeDiagnostics} from '../packages/interpreter/out/index.js';

const [mode = 'compiled', max = '13', variant = 'original'] = process.argv.slice(2);
const path = new URL(variant === 'production'
    ? '../demos/euler/369_badugi.ra'
    : `./experiments/euler369-${variant}.ra`, import.meta.url);
const source = readFileSync(path, 'utf8');
const diagnostics = new RuntimeDiagnostics();
let answer;
const runtime = new Interpreter(text => answer = text, {
    compilation: mode !== 'reference', args: ['--max', max],
});
let session;
if (process.env.PROFILE) {
    session = new Session();
    session.connect();
    await session.post('Profiler.enable');
    await session.post('Profiler.start');
}
const start = performance.now();
try {
    if (process.env.DIAG) diagnostics.run(() => runtime.execute(source));
    else runtime.execute(source);
    if (max === '13') assert.equal(answer, '862400558448');
    console.log(JSON.stringify({mode, max, variant, answer,
        ms: performance.now() - start,
        rssMiB: process.resourceUsage().maxRSS / 1024,
        ...(process.env.DIAG ? {diagnostics} : {}),
    }));
    if (session) {
        const {profile} = await session.post('Profiler.stop');
        writeFileSync(process.env.PROFILE, JSON.stringify(profile));
    }
} finally {
    runtime.dispose();
    session?.disconnect();
}
