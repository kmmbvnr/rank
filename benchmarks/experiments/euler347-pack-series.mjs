import {spawnSync} from 'node:child_process';
const rows=[];
for(let i=0;i<3;i++) for(const name of ['half','slice']) for(const mode of ['compiled','reference']) {
const r=spawnSync(process.execPath,['benchmarks/euler347-investigation.mjs',`benchmarks/experiments/euler347-${name}.ra`,mode],{encoding:'utf8',env:process.env});if(r.status!==0)throw Error(r.stderr);
rows.push({trial:i,...JSON.parse(r.stdout)});
}
console.log(JSON.stringify(rows,null,2));
