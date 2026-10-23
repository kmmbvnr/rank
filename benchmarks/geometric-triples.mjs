// Build each checkout first. Examples:
// node benchmarks/geometric-triples.mjs --checkout=/path/to/baseline --radii=14 --samples=3
// node benchmarks/geometric-triples.mjs --radii=1-50 --samples=1 --timeout=30000
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--(checkout|radii|samples|timeout|worker|source-checkout)=(.+)$/.exec(arg);
    assert(match, `Unknown argument: ${arg}`);
    return [match[1], match[2]];
}));
const checkout = resolve(options.checkout ?? root);
const sourceRoot = resolve(options['source-checkout'] ?? checkout);
const file = 'demos/euler/332_sphericaltriangles.ra';
const source = readFileSync(resolve(sourceRoot, file), 'utf8');
const selection = options.radii ?? '14';
const radii = selection.includes('-') ? (() => {
    const [start, end] = selection.split('-').map(Number);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
})() : selection.split(',').map(Number);
assert(radii.length && radii.every(r => Number.isInteger(r) && r >= 1 && r <= 50));

// Independent host enumeration uses completed numeric points and evaluates
// the original solid-angle formula for every nondegenerate triangle.
function reference(r) {
    const points = [], rr = r * r;
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) {
        const zz = rr - x * x - y * y, z = Math.floor(Math.sqrt(zz));
        if (zz < 0 || z * z !== zz) continue;
        points.push([x, y, z]);
        if (z) points.push([x, y, -z]);
    }
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let best = rr * Math.PI / 2;
    for (let i = 0; i < points.length - 2; i++) for (let j = i + 1; j < points.length - 1; j++) {
        const a = points[i], b = points[j];
        const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        for (let k = j + 1; k < points.length; k++) {
            const c = points[k], d = Math.abs(dot(cross, c));
            if (d === 0) continue;
            best = Math.min(best, 2 * Math.atan2(d / (rr * Math.sqrt(rr)), 1 + (dot(a, b) + dot(b, c) + dot(c, a)) / rr) * rr);
        }
    }
    return { expected: best, points: points.length, triples: points.length * (points.length - 1) * (points.length - 2) / 6 };
}
if (options.worker) {
    const { Interpreter } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const runtime = new Interpreter(() => {});
    runtime.execute(source.match(/^use .+$/gm).join('\n') + '\n' + source.slice(source.indexOf('fun R sphere')));
    let answer = 0;
    const start = performance.now();
    try {
        for (const r of radii) {
            const before = performance.now();
            const actual = runtime.execute(`${r} sphere`);
            const ms = performance.now() - before;
            answer += actual;
            console.log(JSON.stringify({ r, actual, ms }));
        }
        console.log(JSON.stringify({ answer, totalMs: performance.now() - start, maxRSSKiB: process.resourceUsage().maxRSS }));
    } finally { runtime.dispose(); }
} else {
    const samples = Number(options.samples ?? 3), timeout = Number(options.timeout ?? 30000);
    assert(Number.isInteger(samples) && samples > 0 && samples <= 10);
    assert(Number.isFinite(timeout) && timeout > 0);
    const expected = new Map(radii.map(r => [r, reference(r)]));
    const results = [];
    for (let sample = 0; sample < samples; sample++) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--checkout=${checkout}`,
            `--source-checkout=${sourceRoot}`, `--radii=${selection}`, '--worker=true'], { encoding: 'utf8', timeout });
        const rows = child.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        for (const row of rows.filter(row => row.r !== undefined)) {
            assert(Math.abs(row.actual - expected.get(row.r).expected) < 1e-9, `radius ${row.r}: ${row.actual}`);
        }
        const timedOut = child.error?.code === 'ETIMEDOUT';
        if (!timedOut) { assert.ifError(child.error); assert.equal(child.status, 0, child.stderr); assert.equal(rows.length, radii.length + 1); }
        const result = { sample, timedOut, rows };
        results.push(result);
        console.error(JSON.stringify(result));
    }
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, checkout, sourceRoot,
        revision: execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        expected: Object.fromEntries(expected), results }, null, 2));
}
