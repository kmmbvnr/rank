import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cpus} from 'node:os';
const runner=fileURLToPath(new URL('../euler324-investigation.mjs',import.meta.url));
const cases=[['compiled','10000','original'],['compiled','10000','period'],['compiled','10000','period-convolve'],['reference','100','original'],['reference','10000','period'],['reference','10000','period-convolve'],['compiled','1000','original'],['compiled','1000','convolve']];
const records=[];
for(let trial=0;trial<3;trial++)for(let j=0;j<cases.length;j++){
 const args=cases[(trial+j)%cases.length];
 const p=spawnSync(process.execPath,[runner,...args],{encoding:'utf8',timeout:45000});
 const r={trial,args,status:p.status,signal:p.signal,...(p.status===0?JSON.parse(p.stdout):{error:p.error?.message,stderr:p.stderr.slice(0,1000)})};
 if(p.status===0 && args[1]==='10000' && r.answer!=='96972774')throw Error('wrong full answer');
 records.push(r);process.stderr.write(JSON.stringify(r)+'\n');
}
console.log(JSON.stringify({node:process.version,cpu:cpus()[0]?.model,records},null,2));
