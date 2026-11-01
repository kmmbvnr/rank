import assert from 'node:assert/strict';
import {copyEuler309Baseline} from './euler309-baseline.mjs';
import {mkdtempSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const baseline=mkdtempSync(join(tmpdir(),'rank309-source-'));
symlinkSync(new URL('../../node_modules',import.meta.url),join(baseline,'node_modules'));
copyEuler309Baseline(join(baseline,'runtime'));
const rows=[];
const cases=[['compiled','1000000','original'],['compiled','1000000','packed'],['compiled','1000000','copied-groups'],['compiled','1000000','parity'],['compiled','1000000','slices'],['reference','100000','original'],['reference','100000','packed']];
for(let i=0;i<3;i++)for(const c of [...cases.slice(i),...cases.slice(0,i)]){
 const r=spawnSync(process.execPath,[new URL('../euler309-investigation.mjs',import.meta.url).pathname,...c],{encoding:'utf8',timeout:45000,env:{...process.env,RANK_BENCH_RUNTIME:join(baseline,'runtime/index.js')}});
 assert.equal(r.status,0,r.stderr || String(r.error));
 const row=JSON.parse(r.stdout);assert.equal(row.answer,c[1]==='1000000'?'210139':'18609');rows.push({sample:i,...row});
 console.log(JSON.stringify({sample:i,...Object.fromEntries(Object.entries(row).filter(([k])=>k!=='diagnostics'))}));
 writeFileSync(new URL('../baselines/2026-11-01-euler309-samples.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
}
