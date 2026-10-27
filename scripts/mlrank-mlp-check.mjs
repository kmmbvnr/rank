import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Interpreter, compileRam, isRankArray } from '../packages/interpreter/out/index.js';
import { runRamGpu, closeRamGpu } from '../packages/cli/out/ram-gpu.js';

const source = readFileSync('demos/mlrank/classifier.ram', 'utf8');
const fixtures = [];
// Independent scalar reference: s = x+y, d = max(y-x,0).
for (const input of [[0,0,0,1,1,0,1,1], [-1,0,0.25,0.75,0.5,0.5,2,-1]]) {
    const hidden = [], logits = [], probabilities = [];
    for (let i = 0; i < input.length; i += 2) {
        const [x,y] = input.slice(i,i+2);
        const h = [Math.max(x+y,0), Math.max(x+y-1,0), Math.max(y-x,0)];
        hidden.push(...h);
        const a = 2-4*h[0]+8*h[1]+h[2], b = -2+4*h[0]-8*h[1]+h[2];
        logits.push(a,b);
        const p = 1/(1+Math.exp(b-a)); probabilities.push(p,1-p);
    }
    const cpu = new Interpreter(() => {});
    cpu.execute('use linalg\nuse ml');
    cpu.variables.set('X', {kind:'array',shape:[4,2],items:input});
    const cpuSource = source.replace('use ml\noption X .f32 shape 4 2\n','')
        .replace(/option (\w+) \.f32 shape [\d ]+ = /g, '$1 = ')
        .replace('X W1 linear','X matmul W1').replace('Hidden W2 linear','Hidden matmul W2')
        .replace('return Logits softmax','Logits');
    const cpuLogits = cpu.execute(cpuSource);
    assert.ok(isRankArray(cpuLogits)); assert.deepEqual(cpuLogits.items, logits);
    const cpuHidden = cpu.execute('Hidden'); assert.deepEqual(cpuHidden.items, hidden);
    cpu.dispose();
    for (const [stage, expected, width] of [['Logits softmax',probabilities,2],['Hidden',hidden,3],['Logits',logits,2]]) {
        const ram = source.replace('return Logits softmax', `return ${stage}`);
        const graph = compileRam(ram, 'classifier.ram').graph;
        fixtures.push({ stage, source: ram, input, expected, shape: [4,2], outputShape: [4,width],
            model: Buffer.from(graph.model).toString('base64') });
    }
}
// Same graph with changed weights must invalidate the native model cache.
const last = fixtures.findLast(f => f.stage === 'Logits softmax');
const changed = last.source.replace('array 2.0 -2.0', 'array -2.0 2.0');
const changedExpected = last.expected.flatMap((_,i) => i%2 ? [] : (() => {
    const p = last.expected[i]; const q = 1/(1+Math.exp(Math.log((1-p)/p)+8)); return [q,1-q];
})());
fixtures.push({...last, source: changed, expected: changedExpected,
    model: Buffer.from(compileRam(changed,'classifier.ram').graph.model).toString('base64')});
if (process.argv.includes('--android')) {
    mkdirSync('output/playwright', {recursive:true});
    writeFileSync('output/playwright/ram-mlp.js', readFileSync('packages/web/test/ram-mlp.playwright.js','utf8')
        .replace('__RAM_FIXTURES__', JSON.stringify(fixtures)));
} else {
    closeRamGpu();
    const checks = []; let previousModel;
    const memoryBefore = process.memoryUsage();
    const nativeMemory = () => execFileSync('ps', ['-axo','pid,ppid,rss,comm'], {encoding:'utf8'})
        .split('\n').map(line => line.trim().split(/\s+/)).filter(parts => Number(parts[1]) === process.pid && parts.slice(3).join(' ').includes('python'))
        .map(parts => ({pid:Number(parts[0]),rssKiB:Number(parts[2])}));
    let helperMemory;
    for (const f of fixtures) {
        let measurement;
        const interpreter = new Interpreter(() => {}, { loadModule: name => ({id:name,source:f.source}),
            ramGpu: (graph,input) => {
                const request = {model:Buffer.from(graph.model).toString('base64'),input,outputSize:f.expected.length};
                const start = performance.now(); const result = runRamGpu(request); const wallMs = performance.now()-start;
                assert.equal(result.fullyAccelerated,true);
                assert.equal(result.cached,previousModel===f.model); previousModel=f.model;
                measurement = {wallMs, prepareMs:result.prepareMs, executeMs:result.executeMs,
                    transportAndSchedulingMs:wallMs-result.prepareMs-result.executeMs,
                    requestBytes:Buffer.byteLength(JSON.stringify(request)), modelBytes:Buffer.from(f.model,'base64').length};
                return result.output;
            }});
        if (f !== fixtures[0]) interpreter.execute('use "classifier.ram"');
        interpreter.variables.set('X',{kind:'array',shape:f.shape,items:f.input});
        for (let repeat=0;repeat<6;repeat++) {
            const actual=interpreter.execute(f === fixtures[0] && repeat === 0
                ? readFileSync('demos/mlrank/mlp.ra', 'utf8') : 'X classifier'); assert.ok(isRankArray(actual)); assert.deepEqual(actual.shape,f.outputShape);
            const errors=actual.items.map((x,i)=>Math.abs(x-f.expected[i]));
            errors.forEach((error,i)=>assert.ok(error<=1e-5+1e-5*Math.abs(f.expected[i]), `${f.stage}: ${actual.items[i]} != ${f.expected[i]}`));
            if(f.stage==='Logits softmax') for(let i=0;i<actual.items.length;i+=2) {
                assert.ok(Math.abs(actual.items[i]+actual.items[i+1]-1)<1e-5);
                assert.equal(actual.items[i+1]>actual.items[i],f.expected[i+1]>f.expected[i]);
            }
            checks.push({stage:f.stage,repeat,maxError:Math.max(...errors),...measurement});
        }
        helperMemory = nativeMemory();
        interpreter.dispose();
    }
    console.log(JSON.stringify({platform:process.platform,memoryBefore,memoryAfter:process.memoryUsage(),helperMemory,checks},null,2));
    closeRamGpu();
}
