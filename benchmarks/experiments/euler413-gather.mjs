import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const root=process.env.RANK413_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url).pathname;
const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(root));
const compilation=process.argv[2]!=='reference';
const r=new Interpreter(()=>{},{compilation});
try{
 r.execute('use sequences\nA = 0 till 1000000 copy\nIx = 0 till 1000000 by 4 copy');
 const d=new RuntimeDiagnostics(),start=performance.now();
 d.run(()=>r.execute('Answer = (A * 3 + 1) Ix copy\nTotal = Answer sum'));
 const ms=performance.now()-start;
 assert.equal(r.variables.get('Total'),374998750000n);
 console.log(JSON.stringify({compilation,ms,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(r.variables.get('Total')),d}));
}finally{r.dispose();}
