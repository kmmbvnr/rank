import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cpus} from 'node:os';
const runner=fileURLToPath(new URL('../euler326-investigation.mjs',import.meta.url));
const cases=['original','weighted-formula','weighted-accumulate','keyed'].flatMap(variant=>[['compiled','1000000','1000000000000',variant],['reference','10000','1000000000000',variant]]);
const records=[];
for(let trial=0;trial<3;trial++)for(let j=0;j<cases.length;j++){
 const args=cases[(trial+j)%cases.length];
 const p=spawnSync(process.execPath,[runner,...args],{encoding:'utf8',timeout:45000});
 const r={trial,args,status:p.status,signal:p.signal,...(p.status===0?JSON.parse(p.stdout):{error:p.error?.message,stderr:p.stderr.slice(0,1000)})};
 if(p.status===0&&r.answer!==(args[1]==='1000000'?'1966666166408794329':'128888888388011115766'))throw Error('wrong answer');
 records.push(r);process.stderr.write(JSON.stringify(r)+'\n');
}
console.log(JSON.stringify({node:process.version,cpu:cpus()[0]?.model,records},null,2));
