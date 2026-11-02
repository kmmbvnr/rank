import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const runner=fileURLToPath(new URL('../euler328-investigation.mjs',import.meta.url));
const before=process.env.BEFORE_ROOT||'/tmp/rank328-before';
const after=process.env.AFTER_ROOT||fileURLToPath(new URL('../..',import.meta.url));
const samples=[];
for(let trial=0;trial<3;trial++)for(const [variant,root] of trial%2?[['after',after],['before',before]]:[['before',before],['after',after]]){
 const child=spawnSync(process.execPath,[runner,'reference','10000','compact'],{env:{...process.env,RANK_ROOT:root},encoding:'utf8',timeout:30000});assert.ifError(child.error);assert.equal(child.status,0,child.stderr);const record={trial,runtime:variant,...JSON.parse(child.stdout)};assert.equal(record.answer,'456654441');samples.push(record);console.error(JSON.stringify(record));
}
console.log(JSON.stringify(samples,null,2));
