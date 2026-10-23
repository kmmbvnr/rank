// npm run build && node benchmarks/recursive-search.mjs --case=nested
// node benchmarks/recursive-search.mjs --case=euler --limit=10000000000 --samples=1
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
    const match = /^--(case|limit|samples|checkout|worker)=(.+)$/.exec(argument);
    assert(match, `Unknown argument: ${argument}`);
    return [match[1], match[2]];
}));
const name = options.case ?? 'euler', limit = options.limit ?? '1000000';
assert(['nested', 'euler'].includes(name));
const expected = new Map([['100', 193n], ['10000', 51272n], ['1000000', 11626006n],
    ['10000000', 168329190n], ['10000000000', 457895958010n]]);

if (options.worker) {
    const checkout = resolve(options.checkout ?? root);
    const { Interpreter } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
    const runtime = new Interpreter(() => {}, name === 'euler' ? { args: ['--limit', limit] } : {});
    let source, answer;
    if (name === 'nested') {
        runtime.execute(`use algo
fun A Cache N lookup
 if N in Cache
  return Cache N
 end
 Value = A N
 Cache N = Value
 return Value
end
fun A Cache Count scan
 if Count equal 0
  return 0
 end
 return (A Cache (Count - 1) lookup) + (A Cache (Count - 1) scan)
end
A = (0 till 100) array
Cache = new index`);
        source = 'Total = 0\nfor Round in 0 till 1000\n Total += A Cache 100 scan\nend\nTotal';
        answer = 4950000n;
    } else {
        assert(expected.has(limit), 'Use a limit with a checked expected answer');
        source = readFileSync(resolve(checkout, 'demos/euler/362_squarefree.ra'), 'utf8');
        answer = expected.get(limit);
    }
    const start = performance.now();
    const value = runtime.execute(source);
    const ms = performance.now() - start;
    assert.equal(value, answer);
    const states = name === 'euler' ? {
        factorStates: runtime.variables.get('C').entries.size,
        squarefreeStates: runtime.variables.get('Q').entries.size,
    } : {};
    runtime.dispose();
    console.log(JSON.stringify({ ms, answer: String(value), ...states }));
} else {
    const samples = Number(options.samples ?? 3);
    assert(Number.isInteger(samples) && samples > 0);
    const results = [];
    for (let sample = 0; sample < samples; sample++) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker=true',
            `--case=${name}`, `--limit=${limit}`, `--checkout=${options.checkout ?? root}`],
        { encoding: 'utf8', timeout: 300000 });
        assert.equal(child.status, 0, child.stderr || child.error?.message);
        results.push(JSON.parse(child.stdout));
    }
    const ms = results.map(result => result.ms).sort((a, b) => a - b);
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, case: name,
        ...(name === 'euler' ? { limit } : {}), results, medianMs: ms[Math.floor(ms.length / 2)] }, null, 2));
}
