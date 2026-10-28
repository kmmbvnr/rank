// Compare plain stored concat copies with a fixed number of independent copies.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const option=name=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3);
const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(resolve(option('runtime')??'packages/interpreter/out/index.js')));
const size=Number(option('size')??64),rounds=1000;
const source=`use sequences
A = 1 to ${size} array
B = A + 1
Answer = 0
for I in 1 to ${rounds}
  C = (concat A B) copy
  Answer += C len
end`;
const r=new Interpreter(()=>{}),diagnostics=new RuntimeDiagnostics();try{const start=performance.now();diagnostics.run(()=>r.execute(source));const ms=performance.now()-start;const answer=String(r.variables.get('Answer'));assert.equal(answer,String(2*size*rounds));console.log(JSON.stringify({size,rounds,answer,ms,diagnostics,rssMiB:process.resourceUsage().maxRSS/1024}));}finally{r.dispose()}
