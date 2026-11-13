import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {Interpreter, RuntimeDiagnostics}=await import(process.env.RANK_BENCH_RUNTIME?pathToFileURL(process.env.RANK_BENCH_RUNTIME).href:new URL('../packages/interpreter/out/index.js',import.meta.url));
const [mode='compiled',count='1000',variant='original']=process.argv.slice(2);
if(!['compiled','reference'].includes(mode)||!/^[1-9]\d*$/.test(count)||!['original','scalar','eager','gaps','prefix','prefixeager','production'].includes(variant))throw Error('arguments');
let source=readFileSync(new URL(variant==='production'?'../demos/euler/304_primonacci.ra':'./experiments/euler304-original.ra',import.meta.url),'utf8').replace('arg Count integer = 100000',`arg Count integer = ${count}`);
if(process.env.RANK304_START)source=source.replace('arg Start integer = 10 ** 14',`arg Start integer = ${process.env.RANK304_START}`);
if(process.env.RANK304_MOD)source=source.replace('arg Mod integer = 1234567891011',`arg Mod integer = ${process.env.RANK304_MOD}`);
if(variant==='eager')source=source.replaceAll("Twice' =",'Twice =').replaceAll("Shifted' =",'Shifted =').replaceAll("Next' =",'Next =');
if(['scalar','gaps','prefix','prefixeager'].includes(variant))source=source.slice(0,source.indexOf('F0 ='))+readFileSync(new URL(`./experiments/euler304-${variant==='prefixeager'?'prefix':variant}.ra`,import.meta.url),'utf8');
if(variant==='prefixeager')source=source.replaceAll("Twice' =",'Twice =').replaceAll("Shifted' =",'Shifted =').replaceAll("Next' =",'Next =');
const split=source.indexOf(['scalar','gaps','prefix','prefixeager','production'].includes(variant)?'fun ':'F0 =');
const r=new Interpreter(()=>{},{compilation:mode==='compiled'}),d=new RuntimeDiagnostics(),cpu=process.cpuUsage(),start=performance.now();
try{
 d.run(()=>r.execute(source.slice(0,split)));const primeMs=performance.now()-start;
 d.run(()=>r.execute(source.slice(split)));const elapsed=performance.now()-start,usage=process.cpuUsage(cpu);
 const answer=String((r.variables.get('Answer') ?? r.lastResult));
 if(!process.env.RANK304_START&&!process.env.RANK304_MOD&&count==='100000'&&answer!=='283988410192')throw Error(`Answer ${answer}`);
 console.log(JSON.stringify({mode,count:Number(count),variant,answer,primeMs,fibonacciMs:elapsed-primeMs,ms:elapsed,cpuMs:(usage.user+usage.system)/1000,rssMiB:process.resourceUsage().maxRSS/1024,diagnostics:d}));
}finally{r.dispose()}
