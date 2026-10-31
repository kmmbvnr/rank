import {spawnSync} from 'node:child_process';import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const output=new URL('../baselines/2026-10-31-euler303-delivery.json',import.meta.url),samples=existsSync(output)?JSON.parse(readFileSync(output,'utf8')):[];
const cases=[];
for(let round=0;round<3;round++){
 const group=[{version:'before',variant:'original'},{version:'before',variant:'production'},{version:'final',variant:'original'},{version:'final',variant:'production'}];
 for(const c of group.slice(round).concat(group.slice(0,round)))cases.push({round,mode:'compiled',limit:'10000',...c});
 for(const version of round%2?['after','before']:['before','after'])cases.push({round,mode:'reference',limit:'1000',version,variant:version==='before'?'original':'production'});
}
for(const version of ['before','after'])cases.push({round:0,mode:'reference',limit:'10000',version,variant:version==='before'?'original':'production'});
for(const c of cases){
 if(samples.some(x=>Object.keys(c).every(k=>String(x[k])===String(c[k]))))continue;
 const p=spawnSync(process.execPath,[new URL('../euler303-investigation.mjs',import.meta.url).pathname,c.mode,c.limit,c.variant],{encoding:'utf8',timeout:180000,env:{...process.env,...(c.version==='before'?{RANK_BENCH_RUNTIME:process.env.RANK303_BASELINE??'/tmp/rank303-before/out/index.js'}:{})}});
 const value=p.status===0?{...JSON.parse(p.stdout),...c}:{...c,timeout:p.error?.code==='ETIMEDOUT',error:String(p.error??p.stderr)};
 samples.push(value);writeFileSync(output,JSON.stringify(samples,null,2)+'\n');console.log(JSON.stringify(value));
 if(p.status!==0&&!value.timeout)process.exit(1);
}
