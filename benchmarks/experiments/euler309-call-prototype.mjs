// Diagnostic experiment only. Removing this guard is NOT a production-safe fix:
// arbitrary callees can observe index writes hidden in a private overlay.
import assert from 'node:assert/strict';
import {copyEuler309Baseline} from './euler309-baseline.mjs';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'rank309-calls-'));
copyEuler309Baseline(join(dir,'runtime'));
copyEuler309Baseline(join(dir,'baseline'));
symlinkSync(new URL('../../node_modules',import.meta.url),join(dir,'node_modules'));
const file=join(dir,'runtime/jit/number-loop-runtime.js'),source=readFileSync(file,'utf8'),guard='|| plan.containers.size > 0 && plan.calls.length > 0';
assert(source.includes(guard));writeFileSync(file,source.replace(guard,''));
const rows=[];
for(let i=0;i<3;i++)for(const prototype of i%2?[true,false]:[false,true]){
 const env={...process.env,RANK_BENCH_RUNTIME:join(dir,prototype?'runtime/index.js':'baseline/index.js')};
 const r=spawnSync(process.execPath,[new URL('../euler309-investigation.mjs',import.meta.url).pathname,'compiled','1000000','original'],{encoding:'utf8',timeout:45000,env});
 assert.equal(r.status,0,r.stderr || String(r.error));const row={sample:i,prototype,...JSON.parse(r.stdout)};assert.equal(row.answer,'210139');rows.push(row);
 writeFileSync(new URL('../baselines/2026-11-01-euler309-call-prototype.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
 console.log(JSON.stringify({sample:i,prototype,ms:row.ms,rssMiB:row.rssMiB,numberLoops:row.diagnostics.numberLoops}));
}
