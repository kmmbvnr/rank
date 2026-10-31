import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK_BENCH_RUNTIME?pathToFileURL(process.env.RANK_BENCH_RUNTIME).href:new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const [mode='compiled',power='8',variant='original']=process.argv.slice(2);
if(!['compiled','reference'].includes(mode)||!['original','reuse','prune','packed','production'].includes(variant)||!/^([2-9]|1[0-8])$/.test(power))throw Error('Expected compiled|reference, power 2..18, original|reuse|prune');
let s=readFileSync(new URL(variant==='production'?'../demos/euler/302_strongachilles.ra':'./experiments/euler302-original.ra',import.meta.url),'utf8').replace('10 ** 18',`10 ** ${power}`);
if(!['original','production'].includes(variant))s=readFileSync(new URL(`./experiments/euler302-${variant}.ra`,import.meta.url),'utf8').replace('10 ** 18',`10 ** ${power}`);
let compiledFunctions=0;
const rt=new Interpreter(()=>{},{compilation:mode==='compiled',...(process.env.DIAGNOSTICS?{onScalarFunctionExecuted:()=>compiledFunctions++}:{})}),d=new RuntimeDiagnostics();
let t=performance.now();
try{if(process.env.DIAGNOSTICS)d.run(()=>rt.execute(s));else rt.execute(s);const golden={4:'7',8:'656',12:'16176',14:'70645',18:'1170060'}[power];if(golden&&String(rt.variables.get('Answer'))!==golden)throw Error('Answer mismatch');console.log(JSON.stringify({mode,power,variant,answer:String(rt.variables.get('Answer')),ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,...(process.env.DIAGNOSTICS?{compiledFunctions,diagnostics:d}:{})}));}finally{rt.dispose()}
