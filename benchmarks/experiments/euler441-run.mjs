import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK441_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const[mode='compiled',limit='10000000',file='demos/euler/441_inversesum.ra']=process.argv.slice(2);
const runtime=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--n=${limit}`, ...(process.env.RANK441_CUT ? [`--cut=${process.env.RANK441_CUT}`] : []), ...(process.env.RANK441_DIGITS ? [`--digits=${process.env.RANK441_DIGITS}`] : [])]});
const diagnostics=new RuntimeDiagnostics(),start=performance.now();
try{let source=readFileSync(file,'utf8');diagnostics.run(()=>runtime.execute(source));const ms=performance.now()-start;console.log(JSON.stringify({mode,limit,file,node:process.version,arch:process.arch,sourceSha256:createHash('sha256').update(source).digest('hex'),ms,rssMiB:process.resourceUsage().maxRSS/1024,heapMiB:process.memoryUsage().heapUsed/1048576,externalMiB:process.memoryUsage().external/1048576,arrayBuffersMiB:process.memoryUsage().arrayBuffers/1048576,answer:String(runtime.variables.get('Answer')),raw:runtime.variables.get('Raw')??(Number(runtime.variables.get('Tot'))-1),diagnostics}));}catch(e){console.error(e.format?.()??String(e));process.exitCode=1;}finally{runtime.dispose();}
