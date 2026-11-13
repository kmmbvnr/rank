import {readFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK_BENCH_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [mode='compiled',limit='100000',variant='original',phase='all']=process.argv.slice(2);
if(!['compiled','reference','exact'].includes(mode)||!/^\d+$/.test(limit)||!['original','scalar','histogram','histogram-array','inline-histogram','production'].includes(variant)||!['all','split'].includes(phase))throw Error('mode limit variant phase');
const source=readFileSync(new URL(variant==='production'?'../demos/euler/310_nimsquare.ra':`./experiments/euler310-${variant}.ra`,import.meta.url),'utf8').replace('arg Limit integer = 100000',`arg Limit integer = ${limit}`);
const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'}),d=new RuntimeDiagnostics(),parts=[];
try {
 const t=performance.now(),cpu=process.cpuUsage();
 for(const code of phase==='split'?[source.slice(0,source.indexOf('Max =')),source.slice(source.indexOf('Max ='))]:[source]){
  const start=performance.now();d.run(()=>r.execute(code));parts.push(performance.now()-start);
 }
 const c=process.cpuUsage(cpu),answer=String((r.variables.get('Answer') ?? r.lastResult));
 if(limit==='100000'&&answer!=='2586528661783')throw Error(`full golden mismatch: ${answer}`);
 console.log(JSON.stringify({mode,limit,variant,phase,ms:performance.now()-t,cpuMs:(c.user+c.system)/1000,rssMiB:process.resourceUsage().maxRSS/1024,answer,max:String(r.variables.get('Max')),parts,diagnostics:d}));
}finally{r.dispose();}
