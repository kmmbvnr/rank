import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK433_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const [mode='compiled',n='5000000',file='demos/euler/433_euclidsteps.ra']=process.argv.slice(2);
const runtime=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--n=${n}`]});
const diagnostics=new RuntimeDiagnostics(),start=performance.now();
try{const source=readFileSync(file,'utf8');diagnostics.run(()=>runtime.execute(source));const ms=performance.now()-start;console.log(JSON.stringify({mode,n,file,sourceSha256:createHash('sha256').update(source).digest('hex'),node:process.version,arch:process.arch,ms,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)),diagnostics}));}
catch(error){console.error(error.format?.()??String(error));process.exitCode=1;}
finally{runtime.dispose();}
