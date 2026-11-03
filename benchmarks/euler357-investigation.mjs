import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RUNTIME || new URL('../packages/interpreter/out/index.js', import.meta.url).href);
const [limit='100000',mode='compiled',file='demos/euler/357_primegenerating.ra']=process.argv.slice(2);
const kernels=[]; const r=new Interpreter(()=>{}, {compilation:mode!=='reference',args:[`--limit=${limit}`],onIntegerLoopCompiled:s=>kernels.push(s),onFunctionBodyCompiled:s=>kernels.push(s),onScalarCompiled:s=>kernels.push(s)});
if(process.env.CAPTURE){const F=globalThis.Function;globalThis.Function=new Proxy(F,{construct(t,args){kernels.push(String(args.at(-1)));return Reflect.construct(t,args)},apply(t,self,args){kernels.push(String(args.at(-1)));return Reflect.apply(t,self,args)}})}
const d=new RuntimeDiagnostics(); const t=performance.now();
try {const src=readFileSync(file,'utf8'); if(process.env.DIAG)d.run(()=>r.execute(src));else r.execute(src);
const expected={'0':0n,'1':1n,'2':3n,'10':19n,'100':401n,'10000':262615n,'1000000':524402305n,'100000000':1739023853137n}[limit];
if(expected!==undefined)assert.equal(r.variables.get('Answer'),expected);
console.log(JSON.stringify({limit,mode,file,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(r.variables.get('Answer')),...(process.env.DIAG?{diagnostics:d,kernels:kernels.length}:{})}));if(process.env.KERNELS)writeFileSync(process.env.KERNELS,kernels.join('\n\n'));}finally{r.dispose()}
