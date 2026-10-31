import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const cases=[['compiled','original','100000000'],['compiled','native','100000000'],['compiled','symmetry','100000000'],['compiled','vector','100000000'],['reference','original','1000000'],['reference','symmetry','1000000'],['reference','symmetry','100000000'],['reference','vector','100000000']];
const samples=[];
for(let repeat=0;repeat<3;repeat++)for(let i=0;i<cases.length;i++){
 const args=cases[(i+repeat)%cases.length];const p=spawnSync(process.execPath,['benchmarks/euler299-investigation.mjs',...args],{encoding:'utf8',timeout:45000});assert.equal(p.status,0,p.stderr||p.error?.message);const row={repeat,...JSON.parse(p.stdout)};samples.push(row);console.log(JSON.stringify(row));writeFileSync('benchmarks/baselines/2026-10-31-euler299-samples.json',JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,samples},null,2)+'\n');
}
const p=spawnSync(process.execPath,['benchmarks/euler299-investigation.mjs','reference','original','100000000'],{encoding:'utf8',timeout:30000});
const control=p.status===0?JSON.parse(p.stdout):{mode:'reference',variant:'original',limit:'100000000',timeoutMs:30000,status:p.status,error:p.error?.code,signal:p.signal};
writeFileSync('benchmarks/baselines/2026-10-31-euler299-full-reference-control.json',JSON.stringify(control,null,2)+'\n');console.log(JSON.stringify(control));
