import {spawnSync} from 'node:child_process';import {writeFileSync} from 'node:fs';
const cases=[['original',false],['early',false],['arrayearly',false],['arrayearly',true],['original',true]],samples=[];
for(let round=0;round<3;round++){
 for(const [variant,noLinkedCalls] of cases.slice(round).concat(cases.slice(0,round))){
  const p=spawnSync(process.execPath,[new URL('../euler303-investigation.mjs',import.meta.url).pathname,'compiled','10000',variant],{encoding:'utf8',timeout:60000,env:{...process.env,...(noLinkedCalls?{NO_LINKED_CALLS:'1'}:{})}});
  if(p.status!==0)throw Error(p.stderr||String(p.error));const x={round,...JSON.parse(p.stdout)};samples.push(x);console.log(JSON.stringify(x));writeFileSync(new URL('../baselines/2026-10-31-euler303-samples.json',import.meta.url),JSON.stringify(samples,null,2)+'\n');
 }
 for(const variant of ['original','early','arrayearly']){
  const p=spawnSync(process.execPath,[new URL('../euler303-investigation.mjs',import.meta.url).pathname,'reference','1000',variant],{encoding:'utf8',timeout:30000});if(p.status!==0)throw Error(p.stderr||String(p.error));const x={round,...JSON.parse(p.stdout)};samples.push(x);console.log(JSON.stringify(x));writeFileSync(new URL('../baselines/2026-10-31-euler303-samples.json',import.meta.url),JSON.stringify(samples,null,2)+'\n');
 }
}
