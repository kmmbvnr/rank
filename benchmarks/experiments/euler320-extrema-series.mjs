import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {cpus} from 'node:os';
const runner=fileURLToPath(new URL('../euler320-investigation.mjs',import.meta.url));
if(!process.env.PROTO_ROOT)throw Error('PROTO_ROOT must contain the isolated min/max admission prototype');
const records=[];
for(let trial=0;trial<3;trial++)for(const variant of (trial%2?['prototype','baseline']:['baseline','prototype'])){
 const env={...process.env};if(variant==='prototype')env.RANK_ROOT=process.env.PROTO_ROOT;
 const p=spawnSync(process.execPath,[runner,'compiled','1000000','prune-greedy'],{encoding:'utf8',timeout:45000,env});
 if(p.status!==0)throw Error(p.error?.message??p.stderr);
 const r={trial,runtime:variant,...JSON.parse(p.stdout)};
 if(r.answer!=='278157919195482643')throw Error('wrong answer');
 records.push(r);process.stderr.write(JSON.stringify(r)+'\n');
}
console.log(JSON.stringify({node:process.version,cpu:cpus()[0]?.model,records},null,2));
