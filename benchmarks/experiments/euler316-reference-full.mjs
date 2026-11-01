import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const worker=resolve(import.meta.dirname,'../euler316-investigation.mjs'),samples=[];
const rounds=Number(process.argv[3] || 1),start=Number(process.argv[4] || 0);
for(let round=start;round<start+rounds;round++) for(const variant of round%2?['grouped','original']:['original','grouped']) {
 const child=spawnSync(process.execPath,[worker,'reference','999999','10000000000000000',variant],{encoding:'utf8',timeout:45000});
 if(child.error?.code==='ETIMEDOUT')samples.push({round,variant,mode:'reference',timeoutMs:45000});
 else {if(child.status!==0)throw Error(child.stderr || String(child.error));samples.push({round,...JSON.parse(child.stdout)});}
 writeFileSync(process.argv[2],JSON.stringify(samples,null,2)+'\n');console.log(JSON.stringify(samples.at(-1)));
}
