import {readFileSync, writeFileSync, renameSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {render} from './report.mjs';
const output = resolve(process.argv[2] || '/srv/rank-bench/public');
const run = JSON.parse(readFileSync(resolve(output, 'latest.json'), 'utf8'));
const history = readdirSync(resolve(output, 'runs')).filter(x => x.endsWith('.json')).sort().reverse();
let previous;
for (const file of history) {
 const candidate = JSON.parse(readFileSync(resolve(output, 'runs', file), 'utf8'));
 if (candidate.id !== run.id && candidate.status === 'complete' && candidate.method === run.method && candidate.node === run.node && candidate.cpu === run.cpu) { previous = candidate; break; }
}
const file = resolve(output, 'dashboard.html');
writeFileSync(file + '.tmp', render(run, previous));
renameSync(file + '.tmp', file);
