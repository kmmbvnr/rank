import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cpus} from 'node:os';
const runner=fileURLToPath(new URL('../euler320-investigation.mjs',import.meta.url));
const cases=[['compiled','1000000','original'],['compiled','1000000','inline'],['compiled','1000000','prune'],['compiled','1000000','prune-inline'],['compiled','1000000','prune-greedy'],['reference','10000','original'],['reference','10000','prune'],['reference','10000','prune-greedy']];
const records=[];
for(let trial=0;trial<3;trial++)for(let j=0;j<cases.length;j++){
 const args=cases[(trial+j)%cases.length];
 const p=spawnSync(process.execPath,[runner,...args],{encoding:'utf8',timeout:90000});
 const record={trial,args,status:p.status,signal:p.signal,...(p.status===0?JSON.parse(p.stdout):{error:p.error?.message,stderr:p.stderr.slice(0,1000)})};
 const expected=args[1]==='1000000'?'278157919195482643':'61690942682501005';
 if(p.status===0 && record.answer!==expected)throw Error('incorrect answer');
 records.push(record);process.stderr.write(JSON.stringify(record)+'\n');
}
console.log(JSON.stringify({node:process.version,cpu:cpus()[0]?.model,records},null,2));
