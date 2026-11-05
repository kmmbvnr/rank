import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Interpreter } from '../packages/interpreter/out/index.js';
import { ownedStorage } from '../packages/interpreter/out/array-storage-state.js';
import { native } from '../packages/interpreter/out/modules/shared.js';

const size = Number(process.argv[2] ?? 7);
const mode = process.argv[3] ?? 'compiled';
let source = readFileSync(new URL('../demos/euler/701_randomconnectedarea.ra', import.meta.url), 'utf8')
    .replace(/arg (\w+) integer = 7/g, (_, name) => `${name} = ${size}`);
const trace = [];
let cell = -1, peakStates = 0;
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference' });
function storage(value) {
    if (value?.kind === 'record') return Object.fromEntries([...value.entries].map(([name, field]) => [name, storage(field)]));
    if (value?.kind !== 'array') return undefined;
    const owned = ownedStorage.get(value);
    return { shape: value.shape, type: owned?.typed?.constructor.name ?? (owned?.booleans ? 'bitmap' : 'boxed'),
        bytes: owned?.typed?.byteLength ?? owned?.booleans?.words.byteLength,
        cells: value.shape.reduce((a, b) => a * b, 1) };
}
runtime.variables.set('probe', native('probe', 1, ([sample]) => {
    const [value, stage] = sample.items;
    if (stage === 'input') cell++;
    if (value?.kind === 'record') peakStates = Math.max(peakStates, value.entries.get('ways').shape[0]);
    if (stage === 'unique') peakStates = Math.max(peakStates, value.shape[0]);
    trace.push({ cell, stage, memory: process.memoryUsage(), storage: storage(value) });
    return 0n;
}));
const entry = 'fun State blank Row\n';
assert(source.includes(entry), 'missing transition entry for memory probe');
source = source.replace(entry, `${entry}  (tuple State "input") probe\n`);
for (const [line, name, stage] of [
    ['  Labels = (concat (Empty .tags)\n    (Filled .tags))', 'Labels', 'labels'],
    ['  Areas = (concat (Empty .sizes)\n    (Filled .sizes))', 'Areas', 'areas'],
    ['  Key = Labels Areas Best pack', 'Key', 'key'],
    ['  Order = Key argsort', 'Order', 'order'],
    ['  Group = (Marks scan +) - 1', 'Group', 'groups'],
    ['  Weights = Weight Order', 'Weights', 'weights'],
    ['  Unique = Sorted Change', 'Unique', 'unique'],
]) {
    assert(source.includes(line), `missing stage for memory probe: ${stage}`);
    source = source.replace(line, `${line}\n  (tuple ${name} "${stage}") probe`);
}
const start = performance.now();
try {
    runtime.execute(source);
    assert.equal(runtime.variables.get('Sum'), { 5: 273366893n, 6: 738221900249n, 7: 7606015899310446n }[size]);
    console.log(JSON.stringify({ size, mode, node: process.version, arch: process.arch, ms: performance.now() - start,
        total: String(runtime.variables.get('Sum')), peakStates, rssMiB: process.resourceUsage().maxRSS / 1024, trace }));
} finally { runtime.dispose(); }
