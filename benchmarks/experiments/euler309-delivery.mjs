// Prepare an isolated before/after payload; run fresh serial samples on either host.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync,mkdirSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import os from 'node:os';
import {copyEuler309Baseline} from './euler309-baseline.mjs';
const [action,folder,rounds='3',first='0']=process.argv.slice(2);assert(folder,'prepare|run DIRECTORY [rounds] [firstSample]');const root=resolve(folder);
if(action==='prepare'){
 for(const version of ['before','after']){
  for(const name of ['interpreter','language']){
   const out=join(root,version,'packages',name);mkdirSync(out,{recursive:true});
   if(version==='before'&&name==='interpreter')copyEuler309Baseline(join(out,'out'));
   else cpSync(new URL(`../../packages/${name}/out/`,import.meta.url),join(out,'out'),{recursive:true});
   cpSync(new URL(`../../packages/${name}/package.json`,import.meta.url),join(out,'package.json'));
  }
  for(const path of ['benchmarks/euler309-investigation.mjs','benchmarks/experiments/euler309-original.ra','benchmarks/experiments/euler309-delivery-verify.mjs','demos/euler/309_ladders.ra','demos/euler/309_ladders_test.ra']){
   const out=join(root,version,path);mkdirSync(resolve(out,'..'),{recursive:true});cpSync(new URL('../../'+path,import.meta.url),out);
  }
  const modules=join(root,version,'node_modules');mkdirSync(join(modules,'@arrrank'),{recursive:true});
  if(!existsSync(join(modules,'@arrrank/language')))symlinkSync('../../packages/language',join(modules,'@arrrank/language'));
  for(const name of ['langium','chevrotain-allstar','apache-arrow','@noble'])if(!existsSync(join(modules,name)))symlinkSync(new URL('../../node_modules/'+name,import.meta.url),join(modules,name));
 }
 console.log(root);
}else{
 assert.equal(action,'run');assert(/^[1-9]\d*$/.test(rounds)&&/^\d+$/.test(first));
 const rows=[],cases=[['before','compiled','1000000','original'],['after','compiled','1000000','original'],['after','compiled','1000000','production'],['before','reference','100000','original'],['after','reference','100000','production']];
 const host={node:process.version,arch:os.arch(),platform:os.platform(),cpu:os.cpus()[0].model,threads:os.cpus().length,loadStart:os.loadavg()};
 for(let sample=Number(first);sample<Number(first)+Number(rounds);sample++)for(const c of [...cases.slice(sample%cases.length),...cases.slice(0,sample%cases.length)]){
  const r=spawnSync(process.execPath,[join(root,c[0],'benchmarks/euler309-investigation.mjs'),...c.slice(1)],{encoding:'utf8',timeout:90000,env:{...process.env,RANK_BENCH_RUNTIME:join(root,c[0],'packages/interpreter/out/index.js')}});assert.equal(r.status,0,r.stderr||String(r.error));
  const row={sample,version:c[0],...JSON.parse(r.stdout)};assert.equal(row.answer,c[2]==='1000000'?'210139':'18609');rows.push(row);
  writeFileSync(join(root,`results-${os.arch()}.json`),JSON.stringify({host,loadEnd:os.loadavg(),rows},null,2)+'\n');console.log(JSON.stringify({sample,version:c[0],...Object.fromEntries(Object.entries(row).filter(([k])=>k!=='diagnostics'))}));
 }
}
