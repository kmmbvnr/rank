import {readFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK_BENCH_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [mode='compiled',limit='1000000',variant='original']=process.argv.slice(2);
if (!['compiled','reference'].includes(mode) || !/^\d+$/.test(limit) || !['original','packed','copied-groups','parity','slices','production'].includes(variant)) throw Error('mode limit variant');
const source=readFileSync(new URL(variant==='production'?'../demos/euler/309_ladders.ra':`./experiments/euler309-${variant}.ra`,import.meta.url),'utf8').replace('arg Limit integer = 1000000',`arg Limit integer = ${limit}`);
const r=new Interpreter(()=>{},{compilation:mode==='compiled'}),d=new RuntimeDiagnostics();
const t=performance.now(),cpu=process.cpuUsage();
try{d.run(()=>r.execute(source));const u=process.cpuUsage(cpu);if(Number(limit)===1000000 && String((r.variables.get('Answer') ?? r.lastResult))!=='210139') throw Error('full golden mismatch');console.log(JSON.stringify({mode,limit,variant,ms:performance.now()-t,cpuMs:(u.user+u.system)/1000,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((r.variables.get('Answer') ?? r.lastResult)),diagnostics:d}));}finally{r.dispose();}
