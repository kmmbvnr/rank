import {spawnSync} from 'node:child_process';
const rows=[];
for(let i=0;i<3;i++) for(const name of (i%2?['slice','half','original']:['original','half','slice'])) for(const mode of ['compiled','reference']) {
const r=spawnSync(process.execPath,['benchmarks/euler347-investigation.mjs',`benchmarks/experiments/euler347-${name}.ra`,mode],{encoding:'utf8',env:process.env});
if(r.status!==0)throw Error(r.stderr);
const row={trial:i,...JSON.parse(r.stdout)};rows.push(row);process.stderr.write(`${name} ${mode} ${row.ms.toFixed(1)}ms\n`);
}
console.log(JSON.stringify(rows,null,2));
