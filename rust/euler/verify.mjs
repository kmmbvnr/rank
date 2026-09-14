import {readdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {verify} from '../../packages/compile/src/index.js';

const here = fileURLToPath(new URL('./', import.meta.url));
const summaries = [];
for (const name of (await readdir(here)).filter(name => /^\d{3}_/.test(name)).sort()) {
  for (const mode of ['exact', 'i64']) {
    const report = await verify(`${here}/${name}/${mode}`, {timeout: 60000});
    console.log(`${name}/${mode}: ${report.passed}/${report.cases.length}`);
    for (const entry of report.cases.filter(entry => !entry.passed)) console.error(JSON.stringify(entry));
    summaries.push({name, mode, passed: report.passed, total: report.cases.length});
  }
}
await writeFile(`${here}/results.json`, JSON.stringify({date: new Date().toISOString(), summaries}, null, 2) + '\n');
if (summaries.length !== 20 || summaries.some(result => result.passed !== result.total)) process.exitCode = 1;
