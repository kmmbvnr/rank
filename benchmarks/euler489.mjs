import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const chosen = process.env.RANK489_RUNTIME;
const url = chosen ? pathToFileURL(chosen) : new URL('../packages/interpreter/out/index.js', import.meta.url);
const { Interpreter, RuntimeDiagnostics } = await import(url);
const [mode='compiled',ma='18',nb='1900',file='demos/euler/489_commonfactors.ra']=process.argv.slice(2);
const source=readFileSync(file,'utf8');
const runtime=new Interpreter(()=>{}, {compilation:mode!=='reference',args:[`--ma=${ma}`,`--nb=${nb}`]});
const diagnostics=process.env.RANK489_DIAGNOSTICS === '1' ? new RuntimeDiagnostics() : undefined;
const start=performance.now(),cpu=process.cpuUsage();
try {
 if (diagnostics) diagnostics.run(()=>runtime.execute(source)); else runtime.execute(source);
 if (process.env.RANK489_EXPECTED && String(runtime.variables.get('Answer')) !== process.env.RANK489_EXPECTED) throw Error('Wrong answer');
 console.log(JSON.stringify({mode,ma,nb,node:process.version,arch:process.arch,sourceSha256:createHash('sha256').update(source).digest('hex'),ms:performance.now()-start,cpu:process.cpuUsage(cpu),rssMiB:process.resourceUsage().maxRSS/1024,answer:String(runtime.variables.get('Answer')),diagnosticMode:!!diagnostics,diagnostics},null,2));
} finally { runtime.dispose(); }
