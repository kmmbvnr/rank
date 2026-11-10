import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const [root, data, output] = process.argv.slice(2);
const {default: main} = await import(pathToFileURL(resolve(root, 'packages/cli/out/main.js')));
process.chdir(root);
process.argv = [process.execPath, 'rank', 'demos/kaggle/009_dogvscat.ra',
    resolve(data, 'train'), resolve(data, 'test1'), output];
const cpu = process.cpuUsage(), start = performance.now();
await main();
if (process.exitCode) process.exit(process.exitCode);
const ms = performance.now() - start, usage = process.cpuUsage(cpu);
console.log(JSON.stringify({root, ms, cpuMs: (usage.user + usage.system) / 1000,
    peakRssMiB: process.resourceUsage().maxRSS / 1024,
    outputHash: createHash('sha256').update(readFileSync(output)).digest('hex')}));
