import { readFileSync } from 'node:fs';
const { Interpreter, RuntimeDiagnostics } = await import(process.env.RANK428_RUNTIME ?? new URL('../../packages/interpreter/out/index.js', import.meta.url));
const [mode='compiled', n='1000000000', file='demos/euler/428_necklacetriplets.ra'] = process.argv.slice(2);
const runtime = new Interpreter(() => {}, { compilation: mode !== 'reference', ...(mode==='exact' ? {numberLoopCompilation:false,arrayFunctionCompilation:false}:{}), args:[`--n=${n}`] });
const diagnostics = new RuntimeDiagnostics(), start=performance.now();
try {
 diagnostics.run(() => runtime.execute(readFileSync(file,'utf8')));
 console.log(JSON.stringify({mode,n,file,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String((runtime.variables.get('Answer') ?? runtime.lastResult)),diagnostics}));
} catch(e) { console.error(e.format?.()??String(e));process.exitCode=1; }
finally { runtime.dispose(); }
