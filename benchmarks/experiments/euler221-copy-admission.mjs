// Fresh worker; compare runtime policies with identical source and exact answers.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const option=n=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const name=option('case');
const size=name.startsWith('large')?300000:72000;
const full=name.endsWith('full');
const phase=name==='phase';
const fill=name.includes('wide')?2147483648:0;
const rounds=full?3:phase?104:300;
const count=full?String(size):phase?'(R less 100 choose 1 64)':'1';
const source=`use sequences
A = array shape ${size} fill ${fill}
for R in 0 till ${rounds}
 Values = 0 till ${count} array
 for J in Values
  ${phase?'for K in 0 till (R less 100 choose 1 1200)':''}
  A (J mod ${size}) += 1
  ${phase?'end':''}
 end
 Scratch = tuple R
end
Answer = A sum`;
const expected=size*fill+(full?size*rounds:phase?100+4*64*1200:rounds);
const {Interpreter,RuntimeDiagnostics}=await import(pathToFileURL(resolve(option('runtime'))));
const r=new Interpreter(()=>{},{scalarEntryCompilation:false});const d=new RuntimeDiagnostics();
try{
 const start=performance.now();
 if(process.argv.includes('--diagnostic'))d.run(()=>r.execute(source));else r.execute(source);
 const ms=performance.now()-start;assert.equal(r.variables.get('Answer'),BigInt(expected));
 console.log(JSON.stringify({case:name,sourceHash:createHash('sha256').update(source).digest('hex'),ms,rssMiB:process.resourceUsage().maxRSS/1024,answer:expected,...(process.argv.includes('--diagnostic')?{diagnostics:d}:{})}));
}finally{r.dispose();}
