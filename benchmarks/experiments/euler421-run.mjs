import {readFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK421_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const [mode='compiled',m='1000000',file='demos/euler/421_primefactors.ra',n='100000000000']=process.argv.slice(2);
let source=readFileSync(file,'utf8');
const runtime=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--n=${n}`,`--m=${m}`]});
const diagnostics=new RuntimeDiagnostics(),start=performance.now();
try{diagnostics.run(()=>runtime.execute(source));console.log(JSON.stringify({mode,n,m,file,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(runtime.variables.get('Answer')),diagnostics}));}finally{runtime.dispose();}
