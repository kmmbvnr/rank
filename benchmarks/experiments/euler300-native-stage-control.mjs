import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const [file,op='band']=process.argv.slice(2);
const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(file).href);
assert(['band','max'].includes(op));
const n=262144,rounds=120,source=`use bits
A = 0 till ${n} array
B = array shape ${n} fill 7
C = A
Total = 0
for I in 1 to ${rounds}
 C = (A ${op} B) * 2 + A
 Total += C sum
end`;
let expected=0;for(let i=0;i<n;i++)expected+=((op==='band'?i&7:Math.max(i,7))*2+i)*rounds;
const r=new Interpreter(()=>{},{}),d=new RuntimeDiagnostics(),t=performance.now();try{d.run(()=>r.execute(source));assert.equal(Number(r.variables.get('Total')),expected);console.log(JSON.stringify({op,ms:performance.now()-t,rssMiB:process.resourceUsage().maxRSS/1024,numberLoops:d.numberLoops,compiledLoops:d.compiledLoops}));}finally{r.dispose();}
