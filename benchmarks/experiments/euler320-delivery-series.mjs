import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cpus} from 'node:os';
const runner=fileURLToPath(new URL('../euler320-investigation.mjs',import.meta.url));
const cases=[['compiled','1000000','original'],['compiled','1000000','production'],['reference','10000','original'],['reference','10000','production']];
const records=[];
for(let trial=0;trial<3;trial++)for(let j=0;j<cases.length;j++){
 const args=cases[(trial+j)%cases.length];
 const p=spawnSync(process.execPath,[runner,...args],{encoding:'utf8',timeout:90000});
 if(p.status!==0)throw Error(p.error?.message??p.stderr);
 const record={trial,...JSON.parse(p.stdout)};
 const expected=args[1]==='1000000'?'278157919195482643':'61690942682501005';
 if(record.answer!==expected)throw Error('incorrect answer');
 records.push(record);process.stderr.write(JSON.stringify(record)+'\n');
}
console.log(JSON.stringify({node:process.version,cpu:cpus()[0]?.model,method:'Three fresh processes per case, rotating serial order; parse/analysis/compilation/execution included; imports and interpreter construction excluded; peak total process RSS',records},null,2));
