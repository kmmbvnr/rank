import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const power=process.argv[2]??'12';
if(!['12','14'].includes(power))throw Error('Expected 12 or 14');
const variants=power==='12'?['original','reuse','prune']:['original','reuse'],samples=[];
for(let round=0;round<3;round++)for(const mode of ['compiled','reference']){
 const order=power==='12'?variants.slice(round).concat(variants.slice(0,round)):round%2?[...variants].reverse():variants;
 for(const variant of order){
  const p=spawnSync(process.execPath,[new URL('../euler302-investigation.mjs',import.meta.url).pathname,mode,power,variant],{encoding:'utf8',timeout:60000});
  if(p.status!==0)throw Error(p.stderr||String(p.error));
  const sample={round,...JSON.parse(p.stdout)};samples.push(sample);console.log(JSON.stringify(sample));
 }
}
writeFileSync(new URL(`../baselines/2026-10-31-euler302-${power==='12'?'samples':'scale'}.json`,import.meta.url),JSON.stringify(samples,null,2)+'\n');
