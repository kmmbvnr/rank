import {readFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK420_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const [mode='compiled',n='10000000',file=new URL('./euler420-original.ra',import.meta.url)]=process.argv.slice(2);
let source=readFileSync(file,'utf8');
if(process.env.PHASES)for(const [marker,name]of [['Nm =','pairs'],['Tot = 0','tau'],['Answer =','sum']])source=source.replace(marker,`"phase:${name}" print\n${marker}`);
const phases=[];let previous=performance.now();
const runtime=new Interpreter(line=>{if(line.startsWith('phase:')){const now=performance.now();phases.push({name:line.trim(),ms:now-previous,rssMiB:process.memoryUsage().rss/2**20});previous=now;}},{compilation:mode!=='reference',args:[`--n=${n}`]});
const diagnostics=new RuntimeDiagnostics(),start=performance.now();previous=start;
try{diagnostics.run(()=>runtime.execute(source));console.log(JSON.stringify({mode,n,file,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)),phases,diagnostics}));}finally{runtime.dispose();}
