import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const runner=fileURLToPath(new URL('../euler328-investigation.mjs',import.meta.url));
const samples=[];
for(let trial=0;trial<3;trial++)for(const [mode,n,expected] of [['compiled',200000,'260511850222'],['reference',10000,'456654441']]){
 const child=spawnSync(process.execPath,[runner,mode,String(n),'final'],{encoding:'utf8',timeout:60000});assert.ifError(child.error);assert.equal(child.status,0,child.stderr);const record={trial,...JSON.parse(child.stdout)};assert.equal(record.answer,expected);samples.push(record);console.error(JSON.stringify(record));
}
console.log(JSON.stringify(samples,null,2));
