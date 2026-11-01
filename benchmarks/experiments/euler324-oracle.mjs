// Independent small-height tower enumeration, then exact polynomial powering.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./euler324-original.ra',import.meta.url),'utf8');
export function constants(name){return source.split('\n').filter(l=>l.startsWith(`${name} = array`)||l.startsWith(`${name} = concat ${name}`)).flatMap(l=>(l.slice(l.indexOf('array')+5).match(/\d+/g)||[]).map(BigInt));}
export const modulus=100000007n,initial=constants('A0'),coefficients=constants('C');
assert.equal(initial.length,23);assert.equal(coefficients.length,23);
export const period=modulus*(modulus**2n-1n)*(modulus**3n-1n)*(modulus**5n-1n)/(modulus-1n)**2n;
export function product(a,b){
 const c=Array(45).fill(0n);
 for(let i=0;i<23;i++)for(let j=0;j<23;j++)c[i+j]=(c[i+j]+a[i]*b[j])%modulus;
 for(let i=44;i>=23;i--)for(let j=1;j<=23;j++)c[i-j]=(c[i-j]+c[i]*coefficients[j-1])%modulus;
 return c.slice(0,23);
}
export function power(n){let a=Array(23).fill(0n),b=Array(23).fill(0n);a[0]=1n;b[1]=1n;while(n){if(n&1n)a=product(a,b);b=product(b,b);n>>=1n;}return a;}
export function recurrence(n){return power(n).reduce((s,a,i)=>(s+a*initial[i])%modulus,0n);}
function towers(maxN){
 const transitions=Array.from({length:512},(_,mask)=>{
  const counts=new Map();
  function fill(used,out){
   if(used===511){counts.set(out,(counts.get(out)||0)+1);return;}
   let at=0;while(used&(1<<at))at++;
   fill(used|(1<<at),out|(1<<at));
   for(const next of [at%3<2?at+1:-1,at<6?at+3:-1])if(next>=0&&!(used&(1<<next)))fill(used|(1<<at)|(1<<next),out);
  }
  fill(mask,0);return [...counts];
 });
 let dp=new Float64Array(512);dp[0]=1;const out=[1n];
 for(let height=1;height<=2*maxN;height++){
  const next=new Float64Array(512);
  for(let mask=0;mask<512;mask++)if(dp[mask])for(const [to,count]of transitions[mask])next[to]=(next[to]+dp[mask]*count)%Number(modulus);
  dp=next;if(height%2===0)out.push(BigInt(dp[0]));
 }
 return out;
}
export function certify(){const one=Array(23).fill(0n);one[0]=1n;assert.deepEqual(power(period),one);}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const t=performance.now();certify();const values=towers(50);
 for(let n=0;n<values.length;n++)assert.equal(recurrence(BigInt(n)),values[n]);
 assert.equal(recurrence(5n),96149360n);assert.equal(recurrence(500n),24806056n);assert.equal(recurrence(500000n),30808124n);
 const exp=5n*10n**9999n;const answer=recurrence(exp%period);
 console.log(JSON.stringify({period:String(period),bits:period.toString(2).length,fullAnswer:String(answer),towerChecks:values.length,certificate:true,ms:performance.now()-t}));
}
