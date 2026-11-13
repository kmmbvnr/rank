import {readFileSync,writeFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK414_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
import {source as variantSource} from './euler414-variants.mjs';
const [mode='compiled',first='2',last=first,source='original']=process.argv.slice(2);
const src=source==='delivered'?readFileSync(new URL('../../demos/euler/414_kaprekar.ra',import.meta.url),'utf8'):['original','triangle','triangle-fresh','four','combined','no-mod'].includes(source)?variantSource(source):readFileSync(source,'utf8');
const r=new Interpreter(()=>{},{compilation:mode!=='reference',args:[`--first=${first}`,`--last=${last}`]});
if(process.env.RANK414_DUMP){const Original=globalThis.Function;let n=0;globalThis.Function=new Proxy(Original,{construct(target,args){writeFileSync(`/tmp/rank414-generated-${n++}.js`,String(args.at(-1)));return Reflect.construct(target,args);}});}
const d=new RuntimeDiagnostics(),start=performance.now();
try {d.run(()=>r.execute(src));if(first==='2'&&last==='300'&&String((r.variables.get('Answer') ?? r.lastResult))!=='552506775824935461')throw Error('incorrect full Euler 414 answer');console.log(JSON.stringify({mode,first,last,source,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((r.variables.get('Answer') ?? r.lastResult)),d}));}finally{r.dispose();}
