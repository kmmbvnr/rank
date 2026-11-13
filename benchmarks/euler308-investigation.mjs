import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK_BENCH_RUNTIME ? pathToFileURL(process.env.RANK_BENCH_RUNTIME).href : new URL('../packages/interpreter/out/index.js',import.meta.url));
const [mode='compiled',count='10001',variant='original']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));
assert(/^\d+$/.test(count));
assert(['original','inline','native','production','fallback'].includes(variant));
let source=readFileSync(new URL(['production','fallback'].includes(variant) ? '../demos/euler/308_automaton.ra' : './experiments/euler308-original.ra',import.meta.url),'utf8')
 .replace('arg Target integer = 10001',`arg Target integer = ${count}`);
if(variant==='inline')source=source.replace("  Old = Spf Ix\n  Free' = Ix filter Old equal 0 array",'  Free = Ix filter (Spf Ix) equal 0 array');
if(variant==='native')source=source.slice(0,source.indexOf('Spf ='))+'Spf = Top factorsieve\n'+source.slice(source.indexOf('Start ='));
if(variant==='fallback')source=source.replace('1048575','3');
const runtime=new Interpreter(()=>{},{compilation:mode==='compiled'}),diagnostics=new RuntimeDiagnostics();
const start=performance.now(),cpu=process.cpuUsage();
try{
 diagnostics.run(()=>runtime.execute(source));
 const elapsed=performance.now()-start,usage=process.cpuUsage(cpu),answer=String((runtime.variables.get('Answer') ?? runtime.lastResult));
 if(count==='10001')assert.equal(answer,'1539669807660924');
 console.log(JSON.stringify({mode,count:Number(count),variant,answer,ms:elapsed,cpuMs:(usage.user+usage.system)/1000,rssMiB:process.resourceUsage().maxRSS/1024,diagnostics}));
}finally{runtime.dispose();}
