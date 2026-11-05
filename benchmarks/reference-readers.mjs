import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cpus, loadavg } from 'node:os';
const [checkout, name, engine = 'reference'] = process.argv.slice(2);
const { Interpreter, parse, isRankArray } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/index.js')));
const { readArrayItem } = await import(pathToFileURL(resolve(checkout, 'packages/interpreter/out/array-storage.js')));
const compilation = engine === 'compiled';
let args = [], source, expected;
if (name === 'calls') {
    source = `fun X adjust Y\n A = X + Y\n B = A * 3\n return B - X\nend\nTotal = 0\nfor I in 0 till 100000\n Total += I adjust 7\nend\nTotal`;
    expected = 10002000000n;
} else if (name === 'powers') {
    source = `use sequences\nT = 0 till 200000 array\nValues' = T ** 2\nKeys' = T mod 64\nValues sum by Keys size 64`;
    expected = Array(64).fill(0n);
    for (let i = 0n; i < 200000n; i++) expected[Number(i % 64n)] += i ** 2n;
} else {
    const cases = {
        '410-middle': ['410_circleandtangent.ra', ['--r=2000000', '--x=3000000', '--block=70000'], 47999414397928n],
        '401-full': ['401_sumsquares.ra', [], 281632621n],
        '410-full': ['410_circleandtangent.ra', [], 799999783589946560n],
        '023': ['023_abundantsums.ra', [], 4179871n],
        '193': ['193_squarefree.ra', ['--power=24'], 10199301n],
        '401': ['401_sumsquares.ra', ['--limit=2000000000000'], 679233331n],
        '410': ['410_circleandtangent.ra', ['--r=200000', '--x=300000', '--block=70000'], 479955026416n],
        '550': ['550_divisorgame.ra', ['--n=100', '--k=3'], 819374n],
    };
    const [file, flags, answer] = cases[name];
    source = readFileSync(resolve(checkout, 'demos/euler', file), 'utf8');
    args = flags; expected = answer;
}
const runtime = new Interpreter(() => {}, { compilation, args });
const program = parse(source);
const cpuStart = process.cpuUsage();
const loadStart = loadavg();
const start = performance.now();
const result = runtime.executeProgram(program, args);
const ms = performance.now() - start;
const cpu = process.cpuUsage(cpuStart);
const actual = Array.isArray(expected) ? (assert(isRankArray(result)), expected.map((_, i) => readArrayItem(result, i)))
    : name === 'calls' ? result : runtime.variables.get('Answer');
assert.deepEqual(actual, expected);
console.log(JSON.stringify({ name, engine, ms, cpuMs: (cpu.user + cpu.system) / 1000, loadStart, rssMiB: process.resourceUsage().maxRSS / 1024, node: process.version, cpu: cpus()[0].model, answer: String(actual) }));
runtime.dispose();
