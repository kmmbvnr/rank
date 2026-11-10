import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const [root, data, output, file = 'demos/kaggle/004_digitsreq.ra'] = process.argv.slice(2);
const {default: main} = await import(pathToFileURL(resolve(root, 'packages/cli/out/main.js')));
process.chdir(root);
process.argv = [process.execPath, 'rank', file,
    resolve(data, 'train.csv'), resolve(data, 'test.csv'), output];
const cpu = process.cpuUsage(), start = performance.now();
await main();
if (process.exitCode) process.exit(process.exitCode);
const ms = performance.now() - start, usage = process.cpuUsage(cpu);
console.log(JSON.stringify({root, ms, cpuMs: (usage.user + usage.system) / 1000,
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
    outputHash: createHash('sha256').update(readFileSync(output)).digest('hex')}));
