import {readFileSync,appendFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(resolve(process.env.RUNTIME ?? 'packages/interpreter/out/index.js')));
// node benchmarks/euler263-investigation.mjs [compiled|reference] [original|prototype] [count=4]
const [mode='compiled',variant='original',count='4']=process.argv.slice(2);
assert(['compiled','reference'].includes(mode));
assert(['original','prototype'].includes(variant));
assert(/^[0-4]$/.test(count));
const file=new URL(variant==='original' ? './experiments/euler263-original.ra' : './experiments/euler263-scalar-practical.ra',import.meta.url);
let source=readFileSync(file,'utf8').replace('arg Count integer = 4',`arg Count integer = ${count}`);
const output=[],d=new RuntimeDiagnostics();
const runtime=new Interpreter(l=>output.push(l),{compilation:mode==='compiled',onIntegerLoopCompiled:process.env.DUMP?c=>appendFileSync(process.env.DUMP,c+'\n// NEXT\n'):undefined});
const t=performance.now();try {d.run(()=>runtime.execute(source));const answer=String(runtime.variables.get('Answer'));assert.equal(answer,['0','219869980','532371800','892985500','2039506520'][+count]);console.log(JSON.stringify({mode,variant,count,ms:performance.now()-t,answer,found:String(runtime.variables.get('Found')),rssMiB:process.resourceUsage().maxRSS/1024,diagnostics:d}));}finally{runtime.dispose();}
