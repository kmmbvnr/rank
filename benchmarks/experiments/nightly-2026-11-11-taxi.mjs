import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const [root, data, output] = process.argv.slice(2);
const {default: main} = await import(pathToFileURL(resolve(root, 'packages/cli/out/main.js')));
process.chdir(root);
process.argv = [process.execPath, 'rank', 'demos/kaggle/008_nytaxi.ra',
    resolve(data, 'train.csv'), resolve(data, 'test.csv'), output];
const cpu = process.cpuUsage(), start = performance.now();
await main();
if (process.exitCode) process.exit(process.exitCode);
const ms = performance.now() - start, usage = process.cpuUsage(cpu);
const peakRssMiB = process.resourceUsage().maxRSS / 1024;
const heap = {};
if (process.env.GC === '1') {
    heap.before = process.memoryUsage().heapUsed;
    for (let turn = 0; turn < 4; turn++) {
        await new Promise(resolve => setImmediate(resolve));
        global.gc();
    }
    heap.after = process.memoryUsage().heapUsed;
}
console.log(JSON.stringify({root, ms, cpuMs: (usage.user + usage.system) / 1000,
    peakRssMiB, heap,
    outputHash: createHash('sha256').update(readFileSync(output)).digest('hex')}));
