import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const rows=[];
const cases=process.argv[2]==='small' ? [['reference','original','10000'],['reference','pruned','10000'],['reference','combined','10000'],['reference','vector','10000'],['reference','sums','10000']] : [['compiled','vector','100000'],['compiled','sums','100000'],['reference','combined','100000'],['reference','vector','100000'],['reference','sums','100000']];
for(const args of cases){const p=spawnSync(process.execPath,['benchmarks/euler296-investigation.mjs',...args],{encoding:'utf8',timeout:45000,maxBuffer:2**20}); const row=p.status===0?JSON.parse(p.stdout):{args,status:p.status,error:p.error?.code,stderr:p.stderr};rows.push(row);console.log(JSON.stringify(row));writeFileSync(`/tmp/rank296-${process.argv[2]??'full'}.json`,JSON.stringify(rows,null,2));}
