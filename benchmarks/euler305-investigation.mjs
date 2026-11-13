import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK_BENCH_RUNTIME?pathToFileURL(process.env.RANK_BENCH_RUNTIME).href:new URL('../packages/interpreter/out/index.js',import.meta.url));
const [mode='compiled',power='3',variant='original']=process.argv.slice(2);
if(!['compiled','reference'].includes(mode)||!/^\d+$/.test(power)||Number(power)>13||!['original','numeric','pairs','prefix','combined','compact','production'].includes(variant))throw Error('arguments');
const source=readFileSync(new URL(variant==='production'?'../demos/euler/305_reflexive.ra':`./experiments/euler305-${variant}.ra`,import.meta.url),'utf8').replace('arg Power integer = 13',`arg Power integer = ${power}`);
let calls=0;const r=new Interpreter(()=>{},{compilation:mode==='compiled',onScalarFunctionExecuted:()=>calls++}),d=new RuntimeDiagnostics(),t=performance.now(),cpu=process.cpuUsage();
try{d.run(()=>r.execute(source));const answer=String((r.variables.get('Answer') ?? r.lastResult));if(power==='13'&&answer!=='18174995535140')throw Error(`Answer ${answer}`);const usage=process.cpuUsage(cpu);console.log(JSON.stringify({mode,power:Number(power),variant,answer,ms:performance.now()-t,cpuMs:(usage.user+usage.system)/1000,rssMiB:process.resourceUsage().maxRSS/1024,calls,diagnostics:d}));}finally{r.dispose();}
