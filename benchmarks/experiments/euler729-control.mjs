// Paired warm CPU control. Run with --expose-gc and RANK_BASE set to a built baseline.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '../..');
if (!process.env.RANK_BASE || !global.gc) throw Error('Set RANK_BASE and pass --expose-gc');
const versions = await Promise.all([resolve(process.env.RANK_BASE), root].map(async (path, index) =>
    ({ name: index ? 'current' : 'baseline', Interpreter: (await import(pathToFileURL(`${path}/packages/interpreter/out/index.js`))).Interpreter })));
const source = readFileSync(new URL('../../demos/euler/726_fallingbottles.ra', import.meta.url), 'utf8');
function run(version, sample) {
    global.gc();
    const host = new version.Interpreter(() => {}), cpu = process.cpuUsage(), start = performance.now();
    try {
        host.execute(source);
        if ((host.variables.get('Answer') ?? host.lastResult) !== 578040951n) throw Error('wrong control answer');
        const elapsed = process.cpuUsage(cpu);
        return { version: version.name, sample, ms: performance.now() - start, cpuMs: (elapsed.user + elapsed.system) / 1000 };
    } finally { host.dispose(); }
}
for (const version of versions) run(version, 0);
for (let sample = 1; sample <= 6; sample++) {
    const order = sample % 2 ? versions : [...versions].reverse();
    for (const version of order) console.log(JSON.stringify(run(version, sample)));
}
