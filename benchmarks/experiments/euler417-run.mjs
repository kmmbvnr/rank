import {readFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK417_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const [mode='compiled',n='100000000',file=new URL('./euler417-original.ra',import.meta.url)]=process.argv.slice(2);
let source=readFileSync(file,'utf8');
if(process.env.PHASES)for(const [marker,name]of [['Sp = Sp copy','sieve'],['Tot = 0','setup'],['Answer = Tot','orders']])source=source.replace(marker,`"phase:${name}" print\n${marker}`);
const phases=[];let previous=performance.now();
const runtime=new Interpreter(line=>{if(line.startsWith('phase:')){const now=performance.now();phases.push({name:line.trim(),ms:now-previous});previous=now;}},{compilation:mode!=='reference',args:[`--n=${n}`]});
const diagnosticsEnabled=process.env.RANK417_DIAGNOSTICS!=='0';
const diagnostics=new RuntimeDiagnostics(),start=performance.now();previous=start;
try{diagnosticsEnabled?diagnostics.run(()=>runtime.execute(source)):runtime.execute(source);console.log(JSON.stringify({mode,n,file,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)),phases,diagnosticsEnabled,diagnostics:diagnosticsEnabled?diagnostics:undefined}));}finally{runtime.dispose();}
