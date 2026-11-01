import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cpus} from 'node:os';
const runner=fileURLToPath(new URL('../euler319-investigation.mjs',import.meta.url));
const cases=[['compiled','scan',[]],['compiled','array-sieve-views',[]],['reference','array-sieve-views',[]],['reference','array-sieve-views',['--max-old-space-size=512']]];
const records=[];
for(let trial=0;trial<3;trial++)for(let j=0;j<cases.length;j++){
 const [mode,variant,nodeArgs]=cases[(trial+j)%cases.length];
 const p=spawnSync(process.execPath,[...nodeArgs,runner,mode,'10000000000','4641589',variant],{encoding:'utf8',timeout:45000});
 const record={trial,nodeArgs,status:p.status,signal:p.signal,...(p.status===0?JSON.parse(p.stdout):{error:p.error?.message,stderr:p.stderr.slice(0,1000)})};
 if(p.status===0 && record.answer!=='268457129')throw Error('incorrect answer');
 records.push(record);process.stderr.write(JSON.stringify(record)+'\n');
}
console.log(JSON.stringify({node:process.version,cpu:cpus()[0]?.model,records},null,2));
