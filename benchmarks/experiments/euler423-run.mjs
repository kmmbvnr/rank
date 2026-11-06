import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const runtimeURL=process.env.RANK423_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url);
const {Interpreter,RuntimeDiagnostics}=await import(runtimeURL);
const entry=createRequire(runtimeURL).resolve('@arrrank/language');
const languageOperationsSha256=createHash('sha256').update(readFileSync(new URL('./operations.js',pathToFileURL(entry)))).digest('hex');
const [mode='compiled',l='1000000',file='demos/euler/423_consecutive.ra']=process.argv.slice(2);
const runtime=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--l=${l}`]});
const diagnostics=new RuntimeDiagnostics(),start=performance.now();
try{diagnostics.run(()=>runtime.execute(readFileSync(file,'utf8')));console.log(JSON.stringify({mode,l,file,languageOperationsSha256,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(runtime.variables.get('Answer')),state:Object.fromEntries(['Tot','Cur','Un','T'].filter(name=>runtime.variables.has(name)).map(name=>[name,String(runtime.variables.get(name))])),diagnostics}));}finally{runtime.dispose();}
