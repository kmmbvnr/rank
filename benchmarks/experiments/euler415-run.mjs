import {sourceFor} from './euler415-variants.mjs';
import {readFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK415_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const [mode='compiled',n='100000000000',limit='10000000',file='original']=process.argv.slice(2);
let source=['original','combined','scoped','prefix-copy','modscan'].includes(file)?sourceFor(file):readFileSync(file,'utf8');
if(process.env.RANK415_PHASES)for(const [marker,label] of [
 ['Mod = 100000000','start'],['Ix = 0 to Lm copy','sieve'],['Nq = N // Lm','prefix'],['Nn = N + 1','cache'],['Nt = 1 + Nm * Nm + Su1 + Su2','combine']])source=source.replace(marker,`"phase:${label}" print\n${marker}`);
let previous=performance.now();const phases=[];
const runtime=new Interpreter(line=>{if(line.startsWith('phase:')){const now=performance.now();phases.push({phase:line.trim(),ms:now-previous,rssMiB:process.memoryUsage().rss/2**20});previous=now;}},{compilation:mode!=='reference',args:[`--n=${n}`,`--l=${limit}`]});
const diagnostics=new RuntimeDiagnostics(),start=performance.now();previous=start;
try{diagnostics.run(()=>runtime.execute(source));console.log(JSON.stringify({mode,n,limit,file,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)),phases,diagnostics}));}finally{runtime.dispose();}
