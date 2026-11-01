import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {prepareMemoryRuntimes} from './euler309-index-memory.mjs';
const paths=prepareMemoryRuntimes(),root=dirname(paths.undo),tests=[];
for(const variant of ['undo','fresh','flatkeys','fresh-flatkeys']){
 const names=['number-loop-index',...variant.includes('flatkeys')?['index-storage']:[]];
 for(const name of names){
  const target=join(root,'tests',variant,`${name}.test.ts`);mkdirSync(dirname(target),{recursive:true});
  const source=execFileSync('git',['show',`241708d2:packages/interpreter/test/${name}.test.ts`],{cwd:fileURLToPath(new URL('../../',import.meta.url)),encoding:'utf8'}).replaceAll("'../src/",`'${paths[variant]}/`);
  writeFileSync(target,source);tests.push(target);
 }
}
const report=join(root,'test-results.json'),config=fileURLToPath(new URL('../../packages/interpreter/scripts/type-audit.config.mjs',import.meta.url));
const result=spawnSync(process.execPath,[fileURLToPath(new URL('../../node_modules/vitest/vitest.mjs',import.meta.url)),'run','--config',config,'--root',root,'--maxWorkers','1','--reporter=json','--outputFile',report,...tests],{encoding:'utf8',timeout:60000});assert.equal(result.status,0,result.stderr.slice(-2000));
const counts=JSON.parse(readFileSync(report,'utf8'));assert(counts.numPassedTests>=80);assert.equal(counts.numFailedTests,0);
const old=await import(join(paths.current,'runtime/index-key.js'));
const cases=[];
for(const nonempty of [false,true])for(const fail of ['overflow','read','error'])cases.push(`use algo
use numbers
Cache = new index
Alias = Cache
Other = new index
${nonempty?'Cache -1 = 77\nOther -2 = 88':''}
A = array 0 0 0
Done = 0
for I in 0 to 2
 Cache I 0 = I
 Alias I 0 += 1
 Other (-I) = I + 10
 Other (-I) += 2
 A I += 1
 Done += I gcd 2
 ${fail==='overflow'?'Wide = 9007199254740991 + I':fail==='read'?'Cache 99 = 9007199254740991 + I\n Wide = Cache 99':'if I equal 2\n  Bad = Cache 999\n end'}
end`);
let compared=0,keys=0;
for(const variant of ['undo','fresh','flatkeys','fresh-flatkeys']){
 const {Interpreter,RuntimeDiagnostics,formatValue,RankError}=await import(join(paths[variant],'index.js'));
 function run(source,mode){
  const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact',scalarEntryCompilation:false}),d=new RuntimeDiagnostics();let error;
  try{d.run(()=>r.execute(source));}catch(e){error=e instanceof RankError?e.format():String(e);}
  const observation={error,variables:[...r.variables].map(([k,v])=>[k,v?.kind==='index'?[...v.entries].map(([k,v])=>[k,formatValue(v)]):formatValue(v)])};r.dispose();return {observation,d};
 }
 for(const source of cases){
  const value=run(source,'number');assert.deepEqual(value.observation,run(source,'reference').observation);assert.deepEqual(value.observation,run(source,'exact').observation);assert(value.d.numberLoops>0);if(source.includes('Wide ='))assert(value.d.numberLoopOverflows>0);compared+=2;
 }
 if(variant.includes('flatkeys')){
  const changed=await import(join(paths[variant],'runtime/index-key.js'));
  const values=[-0,0n,1,1n,-1,-1n,9007199254740991,9007199254740992,9007199254740992n,1e21,10n**30n,-1e21,1.5,NaN,Infinity,'integers:1,2','text'];
  for(const a of values)for(const b of values)for(const tuple of [[a],[a,b],[a,b,0n]]){assert.equal(changed.indexKey(tuple),old.indexKey(tuple));keys++;}
 }
}
const summary={focusedTests:counts.numPassedTests,differentialComparisons:compared,exactEncodedKeyComparisons:keys,note:'Diagnostic runtime copies; not a production compiler fix.'};
writeFileSync(new URL('../baselines/2026-11-01-euler309-memory-verification.json',import.meta.url),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
