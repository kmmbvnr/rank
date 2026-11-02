import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [checkout, kind, file] = process.argv.slice(2);
// Load the CLI before timing, so package startup does not hide language changes.
const {default: main} = await import(pathToFileURL(resolve(checkout, 'packages/cli/out/main.js')));
process.argv = [process.execPath, resolve(checkout, 'packages/cli/bin/cli.js'), ...(kind === 'tests' ? ['test'] : []), file];
const start = performance.now();
await main();
if (process.send) process.send({ms: performance.now() - start}, () => process.disconnect());
