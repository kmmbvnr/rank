import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRamGpu, closeRamGpu } from '../out/ram-gpu.js';

test('persistent GPU bridge reuses a process and recovers after a request error', () => {
    const directory = mkdtempSync(join(tmpdir(), 'rank-gpu-'));
    const runner = join(directory, 'runtime.mjs');
    writeFileSync(runner, `import { createInterface } from 'node:readline';
let key;
for await (const line of createInterface({input:process.stdin})) {
 const request=JSON.parse(line);
 if(request.model==='crash') process.exit(7);
 const result=request.model==='bad' ? {error:'invalid model'} : {output:request.input,backend:String(process.pid),fullyAccelerated:true,cached:key===request.model};
 if(request.model!=='bad') key=request.model;
 process.stdout.write(JSON.stringify(result)+'\\n');
}`);
    const python = process.env.RANK_ML_PYTHON, previousRunner = process.env.RANK_ML_RUNNER;
    try {
        process.env.RANK_ML_PYTHON = process.execPath;
        process.env.RANK_ML_RUNNER = runner;
        const first = runRamGpu({ model: 'one', input: [1, 2, 3] });
        const next = runRamGpu({ model: 'one', input: Array(4096).fill(4) });
        assert.equal(first.cached, false);
        assert.equal(next.cached, true);
        assert.equal(next.backend, first.backend);
        assert.equal(next.output.length, 4096);
        assert.throws(() => runRamGpu({ model: 'bad', input: [] }), /invalid model/);
        const changed = runRamGpu({ model: 'two', input: [5] });
        assert.equal(changed.backend, first.backend);
        assert.equal(changed.cached, false);
        assert.deepEqual(changed.output, [5]);
        assert.throws(() => runRamGpu({ model: 'crash', input: [] }), /runtime exited/);
        const recovered = runRamGpu({ model: 'one', input: [6] });
        assert.notEqual(recovered.backend, first.backend);
        assert.deepEqual(recovered.output, [6]);
    } finally {
        closeRamGpu();
        if (python === undefined) delete process.env.RANK_ML_PYTHON; else process.env.RANK_ML_PYTHON = python;
        if (previousRunner === undefined) delete process.env.RANK_ML_RUNNER; else process.env.RANK_ML_RUNNER = previousRunner;
        rmSync(directory, { recursive: true });
    }
});
