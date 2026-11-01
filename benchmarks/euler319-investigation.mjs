import {sourceFor} from './experiments/euler319-variants.mjs';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=process.env.RANK_ROOT||fileURLToPath(new URL('..',import.meta.url));
const {Interpreter,RuntimeDiagnostics}=await import(`${root}/packages/interpreter/out/index.js`);
const [mode='compiled',n='10000000000',limit='4641589',variant='original']=process.argv.slice(2);
if(!['compiled','reference','exact'].includes(mode)||!/^\d+$/.test(n)||!/^\d+$/.test(limit))throw Error('mode n limit variant');
let source=sourceFor(variant);
const outputs=[];const stages=[];let previous=performance.now();
if(process.env.PHASES && variant==='original') {
 source=source.replace('for I in 1 to Limit','"sieve" print\nfor I in 1 to Limit').replace('rem Dependencies','"prefix" print\nrem Dependencies').replace('Answer = 1','"cache" print\nAnswer = 1');
}
const sources=[];
const runtime=new Interpreter(out=>{outputs.push(out.trim());if(process.env.PHASES){const t=performance.now();stages.push({phase:out.trim(),ms:t-previous});previous=t;}}, {
 compilation:mode!=='reference',numberLoopCompilation:mode!=='exact',args:[`--n=${n}`,`--limit=${limit}`],
 ...(process.env.SOURCES?{onIntegerLoopCompiled:s=>sources.push(s)}:{})
});
const diagnostics=new RuntimeDiagnostics();const begin=performance.now();previous=begin;
try {
 if(process.env.DIAGNOSTICS)diagnostics.run(()=>runtime.execute(source));else runtime.execute(source);
 console.log(JSON.stringify({mode,n,limit,variant,ms:performance.now()-begin,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(runtime.variables.get('Answer')??outputs.at(-1)), ...(stages.length?{stages}:{}),...(process.env.DIAGNOSTICS?{diagnostics}:{} )}));
 if(process.env.SOURCES)writeFileSync(process.env.SOURCES,JSON.stringify(sources,null,2));
}finally{runtime.dispose()}
