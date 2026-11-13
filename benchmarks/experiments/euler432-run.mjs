import {readFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK432_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const [mode='compiled',n='100000000000',l='10000000',file='demos/euler/432_totientsum.ra']=process.argv.slice(2);
const runtime=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--n=${n}`,`--l=${l}`]});
const diagnostics=new RuntimeDiagnostics(),start=performance.now();
try{diagnostics.run(()=>runtime.execute(readFileSync(file,'utf8')));console.log(JSON.stringify({mode,n,l,file,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)),diagnostics}));}
catch(error){console.error(error.format?.()??String(error));process.exitCode=1;}
finally{runtime.dispose();}
