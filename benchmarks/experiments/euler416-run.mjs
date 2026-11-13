import {readFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK416_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const [mode='compiled',m='10',n='1000000000000',file=new URL('./euler416-original.ra',import.meta.url)]=process.argv.slice(2);
let source=readFileSync(file,'utf8');
if(process.env.PHASES)for(const [marker,name] of [['D = Sa len','states'],['V0 = array shape D fill 0','transitions'],['S0 = V0 sum','power']])source=source.replace(marker,`"phase:${name}" print\n${marker}`);
const phases=[];let previous=performance.now();
const runtime=new Interpreter(line=>{if(line.startsWith('phase:')){const now=performance.now();phases.push({name:line.trim(),ms:now-previous});previous=now;}},{compilation:mode!=='reference',args:[`--m=${m}`,`--n=${n}`]});
const diagnostics=new RuntimeDiagnostics(),start=performance.now();previous=start;
try{diagnostics.run(()=>runtime.execute(source));console.log(JSON.stringify({mode,m,n,file,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)),dimension:String(runtime.variables.get('D')),phases,diagnostics}));}finally{runtime.dispose();}
