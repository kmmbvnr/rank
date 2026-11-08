import { spawnSync } from 'node:child_process';
const [baseline] = process.argv.slice(2);
if (!baseline) throw Error('Pass the frozen baseline interpreter out/index.js');
const answers = new Map();
for (let round = 1; round <= 3; round++) {
 for (const id of [486, 487]) for (const variant of round % 2 ? ['before', 'after'] : ['after', 'before']) {
  const env = { ...process.env };
  if (variant === 'before') env[`RANK${id}_RUNTIME`] = baseline; else delete env[`RANK${id}_RUNTIME`];
  const child = spawnSync(process.execPath, [`benchmarks/euler${id}.mjs`, 'compiled'], { env, encoding: 'utf8' });
  if (child.status !== 0) throw Error(child.stderr || child.stdout);
  const run = JSON.parse(child.stdout);
  if (answers.has(id) && answers.get(id) !== run.answer) throw Error('Neighbor answer changed');
  answers.set(id, run.answer);
  console.log(JSON.stringify({ id, variant, round, diagnosticMode: true, ...run }));
 }
}
