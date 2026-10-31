import assert from 'node:assert/strict';
import {Interpreter} from '../packages/interpreter/out/index.js';
const [kind='fill',mode='compiled']=process.argv.slice(2);
assert(['fill','mixedfill','powmod'].includes(kind));
const mixed=`A = array shape 64 fill 0
S = 0
for I in 1 to 200000
 X = I mod 16
 V = I * 17 mod 1009
 A (X to X + 2) = V
 S += V
end
Answer = A sum + S`;
const source=kind==='mixedfill'?mixed:kind==='fill'?`A = array shape 64 fill 0
for I in 1 to 20000
 A (0 till 64 by 2) = I
end
Answer = A sum`:`use numbers
S = 0
for I in 1 to 200000
 S += I 3 17 powmod
end
Answer = S`;
let expected=640000n;
if(kind==='mixedfill'){let sum=0;const a=Array(64).fill(0);for(let i=1;i<=200000;i++){const v=i*17%1009;sum+=v;for(let j=i%16;j<=i%16+2;j++)a[j]=v;}expected=BigInt(sum+a.reduce((x,y)=>x+y,0));}
if(kind==='powmod'){expected=0n;for(let i=1n;i<=200000n;i++)expected+=i**3n%17n;}
const runtime=new Interpreter(()=>{},{compilation:mode==='compiled',scalarEntryCompilation:false});
const start=performance.now();
try{
 runtime.execute(source);const answer=runtime.variables.get('Answer');assert.equal(answer,expected);
 console.log(JSON.stringify({kind,mode,ms:performance.now()-start,answer:String(answer),rssMiB:process.resourceUsage().maxRSS/1024}));
}finally{runtime.dispose();}
