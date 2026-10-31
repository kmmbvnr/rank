import {spawnSync} from 'node:child_process';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const baseline=process.argv[2];if(!baseline)throw Error('Pass the restored baseline interpreter/out/index.js');
const output='benchmarks/baselines/2026-10-31-euler300-delivery.json';
const saved=existsSync(output)?JSON.parse(readFileSync(output,'utf8')):undefined;
const results=saved?.results??[],controls=saved?.controls??[],current=resolve('packages/interpreter/out/index.js');
const cases=[['before','compiled','original'],['after','compiled','original'],['after','compiled','production'],['before','reference','original'],['after','reference','production']];
for(let round=0;round<3;round++)for(let j=0;j<cases.length;j++){
 const [version,mode,variant]=cases[(round+j)%cases.length];
 if(results.some(x=>x.round===round&&x.version===version&&x.mode===mode&&x.variant===variant))continue;
 const child=spawnSync(process.execPath,['benchmarks/euler300-investigation.mjs',mode,variant,'15'],{encoding:'utf8',timeout:90000,env:{...process.env,RANK_BENCH_RUNTIME:version==='before'?baseline:current}});
 if(child.status!==0)throw Error(child.error??child.stderr);
 results.push({round,version,...JSON.parse(child.stdout)});save();console.log(JSON.stringify(results.at(-1)));
}
for(let round=0;round<3;round++)for(const op of ['band','max'])for(const version of round%2?['after','before']:['before','after']){
 if(controls.some(x=>x.round===round&&x.version===version&&x.op===op))continue;
 const child=spawnSync(process.execPath,['benchmarks/experiments/euler300-native-stage-control.mjs',version==='before'?baseline:current,op],{encoding:'utf8',timeout:30000});
 if(child.status!==0)throw Error(child.error??child.stderr);
 controls.push({round,version,...JSON.parse(child.stdout)});save();console.log(JSON.stringify(controls.at(-1)));
}
function save(){writeFileSync(output,JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,base:'89931868',baselineConstruction:'Current compiled runtime with integer-loop-expressions restored and transpiled from 89931868; unchanged expressions use the optional shared frontend hook only in the after version.',results,controls},null,2)+'\n');}
