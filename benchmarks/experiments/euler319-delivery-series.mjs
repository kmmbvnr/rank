import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cpus} from 'node:os';
const runner=fileURLToPath(new URL('../euler319-investigation.mjs',import.meta.url));
if(!process.env.BEFORE_ROOT)throw Error('BEFORE_ROOT must contain the built 4116b44b runtime');
const after=process.env.RANK_ROOT||fileURLToPath(new URL('../..',import.meta.url));
const records=[];
for(let trial=0;trial<5;trial++)for(const version of (trial%2?['after','before']:['before','after'])){
 const p=spawnSync(process.execPath,[runner,'compiled','10000000000','4641589','original'],{encoding:'utf8',timeout:45000,env:{...process.env,RANK_ROOT:version==='before'?process.env.BEFORE_ROOT:after}});
 if(p.status!==0)throw Error(p.error?.message??p.stderr);
 const record={trial,version,...JSON.parse(p.stdout)};
 if(record.answer!=='268457129')throw Error('incorrect answer');
 records.push(record);process.stderr.write(JSON.stringify(record)+'\n');
}
console.log(JSON.stringify({node:process.version,cpu:cpus()[0]?.model,method:'Five fresh processes per version, alternating sequentially; peak process RSS; unchanged original demo; parse/analysis/compile/execution included, imports and interpreter construction excluded',records},null,2));
