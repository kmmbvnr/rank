import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync,writeFileSync} from 'node:fs';
const path=new URL('../baselines/2026-10-31-euler302-delivery.json',import.meta.url);
const before=process.env.RANK302_BASELINE??'/tmp/rank302-before/out/index.js';
const results=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):[];
const cases=[];
for(let round=0;round<3;round++){
 if(round===0)cases.push({round,version:'before',variant:'original',mode:'compiled',power:18});
 cases.push({round,version:'after',variant:'production',mode:'compiled',power:18});
 for(const mode of ['compiled','reference'])for(const version of round%2?['after','before']:['before','after'])cases.push({round,version,mode,power:14,variant:version==='before'?'original':'production'});
 for(const version of round%2?['after','before']:['before','after'])cases.push({round,version,mode:'compiled',power:12,variant:'production'});
}
cases.push({round:0,version:'before',variant:'original',mode:'reference',power:18});
cases.push({round:0,version:'after',variant:'production',mode:'reference',power:18});
for(let round=0;round<3;round++) {
 cases.push({round,version:'after-memory',variant:'production',mode:'compiled',power:18});
 for(const mode of ['compiled','reference'])cases.push({round,version:'after-memory',variant:'production',mode,power:14});
 for(const version of round%2?['after-memory','before-compiler']:['before-compiler','after-memory'])cases.push({round,version,variant:'production',mode:'compiled',power:12});
}
cases.push({round:0,version:'after-memory',variant:'production',mode:'reference',power:18});
for(const c of cases){
 if(results.some(x=>Object.keys(c).every(k=>String(x[k])===String(c[k]))))continue;
 const run=spawnSync(process.execPath,[new URL('../euler302-investigation.mjs',import.meta.url).pathname,c.mode,String(c.power),c.variant],{
  encoding:'utf8',timeout:240000,env:{...process.env,...(c.version==='before'?{RANK_BENCH_RUNTIME:before}:c.version==='before-compiler'?{RANK_BENCH_RUNTIME:process.env.RANK302_COMPILER_BASELINE??'/tmp/rank302-before-compiler/out/index.js'}:c.version==='after'?{RANK_BENCH_RUNTIME:process.env.RANK302_PRE_MEMORY_RUNTIME??'/tmp/rank302-before-signature/out/index.js'}:{})},
 });
 const result=run.status===0?{...c,...JSON.parse(run.stdout)}:{...c,error:String(run.error??run.stderr),timeout:run.error?.code==='ETIMEDOUT'};
 results.push(result);writeFileSync(path,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(result));
 if(run.status!==0&&!result.timeout)process.exit(1);
}
