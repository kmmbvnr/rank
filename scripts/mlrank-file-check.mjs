// Validate file-backed model transport. Optional real Safetensors input stays on disk.
import { mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Interpreter, compileRam } from '../packages/interpreter/out/index.js';
import { nodeIo } from '../packages/cli/out/node-io.js';
import { runRamGpuFile, closeRamGpu, sendRamGpu } from '../packages/cli/out/ram-gpu.js';

const directory = process.env.RANK_FILE_CHECK_DIR ?? mkdtempSync(join(tmpdir(), 'rank-file-gpu-'));
let values = [0.25, -1, 2, 0, -3, 1.5];
if (process.argv[2] && process.argv[2] !== '--compile-only') {
    const interpreter = new Interpreter(undefined, { io: nodeIo, persistentResources: true });
    try {
        const tensor = interpreter.execute(`use io\nF = ${JSON.stringify(resolve(process.argv[2]))} open\nF tensor ${JSON.stringify(process.argv[3])}`);
        assert.equal(tensor.kind, 'array');
        assert.ok(tensor.shape.reduce((a,b)=>a*b,1) <= 1048576, 'This check compiles one bounded tensor, not the complete checkpoint');
        values = tensor.items;
    } finally { interpreter.dispose(); }
}
const source = `use ml\noption X .f32 shape 1 ${values.length}\noption Scale .f32 shape ${values.length} = array shape ${values.length}\n  ${values.map(v=>Number.isInteger(v)?v+'.0':String(v)).join(' ')}\nend\nreturn X * Scale`;
const graph = compileRam(source, 'filecheck.ram').graph;
const path = join(directory, 'filecheck.tflite');
writeFileSync(path, graph.model);
const descriptor = { path, size: statSync(path).size, sha256: createHash('sha256').update(graph.model).digest('hex') };
const input = values.map((_,i)=>Math.fround((i % 7 - 3) / 4));
const expected = input.map((v,i)=>Math.fround(v * values[i]));
writeFileSync(join(directory,'fixture.json'), JSON.stringify({modelFile:descriptor,input,expected}));
if (!process.argv.includes('--compile-only')) {
    try {
        const first = runRamGpuFile(descriptor, input, input.length);
        const again = runRamGpuFile(descriptor, input, input.length);
        for (const result of [first, again]) result.output.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<=1e-5+1e-5*Math.abs(expected[i])));
        assert.equal(first.cached, false); assert.equal(again.cached, true);
        const wrong = sendRamGpu({action:'load',modelFile:{...descriptor,sha256:'0'.repeat(64)}});
        assert.match(wrong.error,/checksum/);
        const truncated = sendRamGpu({action:'load',modelFile:{...descriptor,size:descriptor.size+1}});
        assert.match(truncated.error,/size mismatch/);
        const recovery = runRamGpuFile(descriptor,input,input.length);
        assert.equal(recovery.cached,false);
        recovery.output.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<=1e-5+1e-5*Math.abs(expected[i])));
        const result = {descriptorBytes:Buffer.byteLength(JSON.stringify(descriptor)), modelBytes:graph.model.length,
            elements:values.length, fullyAccelerated:first.fullyAccelerated, repeated:true, checksumRejected:true,
            sizeMismatchRejected:true, staleRecovery:true, maxAbsoluteError:Math.max(...first.output.map((v,i)=>Math.abs(v-expected[i]))),
            directory};
        console.log(JSON.stringify(result,null,2));
    } finally { closeRamGpu(); }
} else console.log(JSON.stringify({directory,descriptor},null,2));
