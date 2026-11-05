import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
import {readArrayItem} from '../../packages/interpreter/out/runtime/array-read.js';
import {multiply} from '../../packages/interpreter/out/runtime/modular-power.js';
const [m='10',n='1000000000000',kernel='fused']=process.argv.slice(2),mod=1000000000;
const start=performance.now();
const runtime=new Interpreter(()=>{},{args:[`--m=${m}`,`--n=${n}`]});
const source=readFileSync(new URL('./euler416-original.ra',import.meta.url),'utf8');
runtime.execute(source.slice(0,source.indexOf('V0 = array shape D fill 0')));
const size=Number(runtime.variables.get('D'));
const stored=name=>{const a=runtime.variables.get(name);return Int32Array.from({length:size*size},(_,i)=>Number(readArrayItem(a,i)));};
let a=stored('T'),b=stored('Z'),v0=new Int32Array(size),v1=new Int32Array(size);
v0[Number(readArrayItem(runtime.variables.get('Id'),2*Number(m)*(2*Number(m)+1)))]=1;
const setupMs=performance.now()-start;
// A control for the exact residue domain of this demo, not a public Rank ABI.
function mm(x,y){
 const columns=y.length/size,right=new Int32Array(y.length),out=new Int32Array(size*columns);
 for(let k=0;k<size;k++)for(let j=0;j<columns;j++)right[j*size+k]=y[k*columns+j];
 if(kernel==='imul'){
  for(let i=0;i<size;i++)for(let j=0;j<columns;j++){
   let total=0;for(let k=0;k<size;k++)total+=multiply(x[i*size+k],right[j*size+k],mod);
   out[i*columns+j]=total%mod;
  }
 }else{
  const high=Int32Array.from(x,v=>Math.floor(v/32768)),low=Int32Array.from(x,v=>v%32768);
  for(let i=0;i<size;i++)for(let j=0;j<columns;j++){
   let hi=0,lo=0;const xi=i*size,yj=j*size;
   for(let k=0;k<size;k++){const v=right[yj+k];hi+=high[xi+k]*v;lo+=low[xi+k]*v;}
   const combined=(hi%mod)*32768+lo;
   if(!Number.isSafeInteger(hi)||!Number.isSafeInteger(lo)||!Number.isSafeInteger(combined))throw Error('unsafe control bound');
   out[i*columns+j]=combined%mod;
  }
 }
 return out;
}
const add=(x,y)=>Int32Array.from(x,(v,i)=>(v+y[i])%mod);
let exponent=BigInt(n)-2n;
while(exponent>0n){
 if(exponent&1n){const next=add(mm(a,v1),mm(b,v0));v0=mm(a,v0);v1=next;}
 const next=add(mm(a,b),mm(b,a));a=mm(a,a);b=next;exponent>>=1n;
}
const answer=(v0.reduce((a,b)=>a+b,0)+v1.reduce((a,b)=>a+b,0))%mod;
console.log(JSON.stringify({m,n,kernel,dimension:size,setupMs,ms:performance.now()-start,rssMiB:process.resourceUsage().maxRSS/1024,answer:String(answer)}));
runtime.dispose();
