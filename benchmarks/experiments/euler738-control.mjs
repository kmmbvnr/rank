import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const source = `use sequences
Size = 262200
A = array shape Size fill 0
Round = 0
for Round less 3
 for I in 0 till Size by 2
  A I += 1
 end
 for I in 1 till Size by 2
  A I += 1
 end
 Round += 1
end
A sum`;
const versions = [resolve(process.argv[2]), resolve(import.meta.dirname, '../..')];
const entries = [];
for (const [index, root] of versions.entries()) {
    const { Interpreter, parse } = await import(pathToFileURL(`${root}/packages/interpreter/out/index.js`));
    const code = [];
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false,
        onIntegerLoopCompiled: source => code.push(source) });
    const program = parse(source);
    const execute = () => {
        const start = performance.now();
        assert.equal(runtime.executeProgram(program), 786600n);
        return performance.now() - start;
    };
    execute(); execute();
    entries.push({ version: index ? 'candidate' : 'baseline', runtime, execute,
        codeHash: createHash('sha256').update(code.join('\n')).digest('hex') });
}
try {
    assert.equal(entries[0].codeHash, entries[1].codeHash, 'generated loop sources differ');
    const samples = [];
    for (let trial = 0; trial < 16; trial++) {
        for (const entry of trial % 2 ? [...entries].reverse() : entries) {
            global.gc();
            const cpu = process.cpuUsage(), ms = entry.execute(), used = process.cpuUsage(cpu);
            global.gc();
            samples.push({ trial, version: entry.version, ms, cpuMs: (used.user + used.system) / 1000,
                heap: process.memoryUsage().heapUsed, buffers: process.memoryUsage().arrayBuffers });
        }
    }
    console.log(JSON.stringify({ node: process.version, loopSourcesEqual: true,
        codeHash: entries[0].codeHash, samples }));
} finally { for (const entry of entries) entry.runtime.dispose(); }
