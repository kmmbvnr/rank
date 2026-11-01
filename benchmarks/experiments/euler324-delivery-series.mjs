import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cpus} from 'node:os';
const runner=fileURLToPath(new URL('../euler324-investigation.mjs',import.meta.url));
const cases=[['compiled','original'],['compiled','production'],['reference','production']];
const records=[];
for(let trial=0;trial<3;trial++)for(let j=0;j<cases.length;j++){
 const [mode,variant]=cases[(trial+j)%cases.length];
 const p=spawnSync(process.execPath,[runner,mode,'10000',variant],{encoding:'utf8',timeout:45000});
 if(p.status!==0)throw Error(p.error?.message??p.stderr);
 const r={trial,...JSON.parse(p.stdout)};
 if(r.answer!=='96972774')throw Error('wrong full answer');
 records.push(r);process.stderr.write(JSON.stringify(r)+'\n');
}
console.log(JSON.stringify({node:process.version,cpu:cpus()[0]?.model,method:'Three fresh processes per case in rotating sequential order; all cases use the full 10000-digit input; parse/analysis/compilation/execution included, imports and interpreter construction excluded; peak process RSS',records},null,2));
