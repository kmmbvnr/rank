import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const runner=fileURLToPath(new URL('../euler328-investigation.mjs',import.meta.url));
const cases=[['compiled',200000,'current'],['compiled',200000,'frontier'],['compiled',200000,'compact'],['reference',10000,'current'],['reference',10000,'frontier'],['reference',10000,'compact']];
const samples=[];
for(let trial=0;trial<3;trial++)for(const [mode,n,variant] of [...cases.slice(trial),...cases.slice(0,trial)]){
 const child=spawnSync(process.execPath,[runner,mode,String(n),variant],{encoding:'utf8',timeout:60000});assert.ifError(child.error);assert.equal(child.status,0,child.stderr);const record={trial,...JSON.parse(child.stdout)};assert.equal(record.answer,n===200000?'260511850222':'456654441');samples.push(record);console.error(JSON.stringify(record));
}
console.log(JSON.stringify({host:process.platform,node:process.version,samples},null,2));
