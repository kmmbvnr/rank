import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {cpus} from 'node:os';
import {Interpreter, RuntimeDiagnostics, control, assertPatched} from './euler370-investigation.mjs';
import {withInterrupt} from '../packages/interpreter/out/interrupt.js';

const demos = {'023': 'abundantsums', '365': 'hugebinomial', '369': 'badugi', '370': 'triangles'};
if (process.argv[2] === 'worker') {
    const id = process.argv[3], polling = process.argv[4] === 'poll';
    const path = `../demos/euler/${id}_${demos[id]}.ra`;
    const source = id === 'nested' ? `Answer = 0
for I in 1 to 1000
 for J in 1 to 1000
  Answer += I + J
 end
end` : readFileSync(new URL(path, import.meta.url), 'utf8');
    const expected = {'023': '4179871', '365': '162619462356610313', '369': '862400558448', '370': '41791929448408', nested: '1001000000'};
    const r = new Interpreter(() => {}), d = new RuntimeDiagnostics();
    try {
        const run = () => r.execute(source), start = performance.now();
        const execute = () => polling ? withInterrupt(new Int32Array(1), run) : run();
        if (process.env.DIAGNOSTICS) d.run(execute); else execute();
        const ms = performance.now() - start, answer = String((r.variables.get('Answer') ?? r.lastResult));
        assert.equal(answer, expected[id]); assertPatched();
        console.log(JSON.stringify({id, polling, control, answer, ms, rssMiB: process.resourceUsage().maxRSS/1024,
            ...(process.env.DIAGNOSTICS ? {diagnostics: d} : {})}));
    } finally { r.dispose(); }
} else {
    const samples = [], trials = Number(process.env.TRIALS || 3);
    const cases = (process.env.CASES || '370,369,365,023,nested').split(',');
    for (let trial=0; trial<trials; trial++) {
        for (const id of cases) for (const polling of id === '370' ? [false,true] : [false]) {
            for (const control of trial%2 ? ['production','baseline'] : ['baseline','production']) {
                const p = spawnSync(process.execPath, [import.meta.filename,'worker',id,polling?'poll':'normal'], {
                    env: {...process.env, CONTROL: control}, encoding: 'utf8', timeout: 180000,
                });
                assert.ifError(p.error); assert.equal(p.status,0,p.stderr);
                const s = {...JSON.parse(p.stdout), trial}; samples.push(s); console.log(JSON.stringify(s));
            }
        }
    }
    if (process.env.OUTPUT) writeFileSync(process.env.OUTPUT, JSON.stringify({node:process.version,cpu:cpus()[0].model,arch:process.arch,samples},null,2)+'\n');
}
