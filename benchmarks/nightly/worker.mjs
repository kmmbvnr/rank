import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [checkout, kind, file] = process.argv.slice(2);
// Load the CLI before timing, so package startup does not hide language changes.
const {default: main} = await import(pathToFileURL(resolve(checkout, 'packages/cli/out/main.js')));
process.argv = [process.execPath, resolve(checkout, 'packages/cli/bin/cli.js'), ...(kind === 'tests' ? ['test'] : []), file];
const cpu = process.cpuUsage(), start = performance.now();
await main();
const ms = performance.now() - start, usage = process.cpuUsage(cpu);
if (process.send) process.send({ms, cpuMs: (usage.user + usage.system) / 1000,
    peakRssMiB: process.resourceUsage().maxRSS / 1024}, () => process.disconnect());
