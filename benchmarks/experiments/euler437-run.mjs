import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK437_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const[mode='compiled',n='100000000',file='demos/euler/437_fibonacciprimitive.ra',block]=process.argv.slice(2);
const runtime=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--n=${n}`]});
const diagnostics=new RuntimeDiagnostics(),start=performance.now();
try{let source=readFileSync(file,'utf8');if(block!==undefined){if(!/^[1-9][0-9]*$/.test(block)||!Number.isSafeInteger(Number(block)))throw Error('invalid block size');if(!/^Block = 65536$/m.test(source))throw Error('program has no batch size');source=source.replace(/^Block = 65536$/m,`Block = ${block}`);}diagnostics.run(()=>runtime.execute(source));const ms=performance.now()-start;console.log(JSON.stringify({mode,n,file,node:process.version,arch:process.arch,sourceSha256:createHash('sha256').update(source).digest('hex'),ms,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(runtime.variables.get('Answer')),diagnostics}));}catch(e){console.error(e.format?.()??String(e));process.exitCode=1;}finally{runtime.dispose();}
