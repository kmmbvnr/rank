import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpus } from 'node:os';
import { Interpreter } from '../packages/interpreter/out/index.js';

// Each mode runs in a fresh process. Disable linking independently from entry
// to measure calls from ordinary Rank code, with the linked loop as a control.
const count = 100000;
const helpers = {
    leaf: 'fun A B helper\n return A * 10 + B\nend',
    loop: 'fun A B helper\n Scale = 10\n for Scale at most B\n  Scale *= 10\n end\n return A * Scale + B\nend',
};
if (process.argv[2] === '--worker') {
    const name = process.argv[3], mode = process.argv[4];
    let calls = 0, loops = 0;
    const runtime = new Interpreter(undefined, {
        scalarCallCompilation: mode === 'linked', scalarEntryCompilation: mode !== 'framed',
        onScalarFunctionExecuted: () => calls++, onIntegerLoopExecuted: () => loops++,
    });
    try {
        runtime.execute(helpers[name]);
        const source = `Total = 0\nfor I in 0 till ${count}\n Total += I 456 helper\nend\nTotal`;
        const expected = BigInt(name === 'leaf' ? 10 : 1000) * BigInt(count) * BigInt(count - 1) / 2n + 456n * BigInt(count);
        const run = () => assert.equal(runtime.execute(source), expected);
        run(); run();
        const samples = [];
        for (let i = 0; i < 7; i++) {
            const start = performance.now(); run(); samples.push(performance.now() - start);
        }
        calls = loops = 0;
        run();
        assert.equal(calls, mode === 'framed' ? 0 : count);
        assert.equal(loops, mode === 'linked' ? 1 : name === 'loop' && mode === 'framed' ? count : 0);
        console.log(JSON.stringify({ name, mode, medianMs: samples.toSorted((a, b) => a - b)[3], samples, calls, loops }));
    } finally { runtime.dispose(); }
} else {
    console.log(JSON.stringify({ node: process.version, cpu: cpus()[0]?.model, count }));
    for (const name of Object.keys(helpers)) for (const mode of ['linked', 'entry', 'framed']) {
        const child = spawnSync(process.execPath, [new URL(import.meta.url).pathname, '--worker', name, mode], { encoding: 'utf8' });
        if (child.status !== 0) throw new Error(child.stderr || child.stdout);
        process.stdout.write(child.stdout);
    }
}
