import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(process.env.RANK_ROOT ?? resolve(import.meta.dirname, '../..'));
const { Interpreter } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
const source = readFileSync(new URL('../../demos/euler/234_semidivisible.ra', import.meta.url), 'utf8');
const runtime = new Interpreter(() => {});
try {
    const start = performance.now(); runtime.execute(source);
    const answer = String(runtime.variables.get('Answer'));
    assert.equal(answer, '1259187438574927161');
    console.log(JSON.stringify({ workload: 'Euler 234 default', answer, ms: performance.now() - start,
        maxRssMiB: process.resourceUsage().maxRSS / 1024 }));
} finally { runtime.dispose(); }
