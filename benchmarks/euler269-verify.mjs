import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// Independent exhaustive oracle: evaluate the digit polynomial at every possible
// integer root. Positive roots cannot cancel nonnegative decimal coefficients;
// a nonzero integer root divides the last nonzero digit, so -9..0 suffice.
function oracle(k) {
 let count=0;
 for(let n=1;n<=10**k;n++) {
  const digits=String(n).split('').map(Number);
  for(let root=-9;root<=0;root++) {
   let value=0;
   for(const digit of digits) value=value*root+digit;
   if(value===0){count++;break;}
  }
 }
 return String(count);
}
for(let k=1;k<=5;k++) {
 const expected=oracle(k);
 for(const mode of ['reference','compiled']) for(const variant of (process.env.VARIANTS?.split(',') ?? ['original','early','broadcast','broadcast-eager','broadcast-terminal','shipping'])) {
  const result=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./euler269-investigation.mjs',import.meta.url)),mode,variant,String(k)],{encoding:'utf8',timeout:30000}));
  assert.equal(result.answer,expected,JSON.stringify({k,mode,variant}));
  console.log(JSON.stringify({k,mode,variant,answer:result.answer,oracle:'exhaustive Horner evaluation'}));
 }
}
