// Fresh-process compiler admission probe. Timings include parsing/lowering/JIT.
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [cap='1024',writesText='100',readsText='2',runtimePath='packages/interpreter/out/index.js']=process.argv.slice(2);
const writes=+writesText,reads=+readsText;
assert(['256','512','1024','none'].includes(cap));
const original=dirname(resolve(runtimePath));
const scratch=mkdtempSync(join(tmpdir(),'rank-budget-'));
cpSync(original,scratch,{recursive:true});
symlinkSync(resolve(original,'../../../node_modules'),join(scratch,'node_modules'));
const expression=join(scratch,'integer-loop-expressions.js');
const generated=readFileSync(expression,'utf8');
assert(generated.includes('MAX_LOOP_TEMPORARIES = 1024'));
writeFileSync(expression,generated.replace('MAX_LOOP_TEMPORARIES = 1024','MAX_LOOP_TEMPORARIES = '+(cap==='none'?'Infinity':cap)));
const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(join(scratch,'index.js')));
let compileEvents=[];const rt=new Interpreter(()=>{},{onIntegerLoopCompiled:source=>compileEvents.push({at:performance.now(),bytes:source.length})});
try {
 rt.execute('A = array 0 1\nCount = 0');
 const rhs=['A 0',...Array(reads-1).fill('A 1'),'I'].join(' + ');
 const source=`for I in 0 till Count\n${Array(writes).fill(' A 0 = '+rhs).join('\n')}\nend`;
 const diag=new RuntimeDiagnostics();let t=performance.now();diag.run(()=>rt.execute(source));const coldMs=performance.now()-t;
 const coldEvents=compileEvents;compileEvents=[];rt.execute('Count = 100');t=performance.now();diag.run(()=>rt.execute(source));const runMs=performance.now()-t;
 const expected=BigInt(writes*(100*(reads-1)+4950));assert.equal(rt.variables.get('A').items[0],expected);
 console.log(JSON.stringify({cap,writes,reads,coldMs,runMs,coldSourceBytes:coldEvents.map(x=>x.bytes),warmCompiles:compileEvents.length,numberLoops:diag.numberLoops,answer:String(expected),rssMiB:process.resourceUsage().maxRSS/1024}));
}finally{rt.dispose();rmSync(scratch,{recursive:true,force:true})}
