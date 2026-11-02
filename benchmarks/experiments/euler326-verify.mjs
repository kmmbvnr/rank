import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../demos/euler/326_modulosums.ra',import.meta.url),'utf8');
const root=process.env.RANK_ROOT||fileURLToPath(new URL('../..',import.meta.url));
const {Interpreter}=await import(`${root}/packages/interpreter/out/index.js`);
function sequence(n){let w=0n;const a=[];for(let i=1;i<=n;i++){const k=BigInt(i),v=i===1?1n:w%k;a.push(v);w+=k*v;}return a;}
function brute(n,m){const a=sequence(n);let count=0n;for(let i=0;i<n;i++){let sum=0n;for(let j=i;j<n;j++){sum+=a[j];if(sum%BigInt(m)===0n)count++;}}return count;}
function periodic(n,m){const a=sequence(6*m),seen=Array(m).fill(0n),tail=Array(m).fill(0n),whole=n/BigInt(6*m),rest=Number(n%BigInt(6*m));let p=0;
 for(let i=0;i<6*m;i++){seen[p]++;if(i<=rest)tail[p]++;p=(p+Number(a[i]))%m;}
 return seen.reduce((s,x,i)=>{const c=whole*x+tail[i];return s+c*(c-1n)/2n;},0n);
}
const cases=[];
for(const m of [1,2,3,5,7,10,11,16]){
 for(const n of new Set([0,1,5,6,7,6*m-1,6*m,6*m+1,12*m+2]))cases.push({m,n:BigInt(n),expected:brute(n,m)});
 for(const n of [1000000000000n,9007199254740993n,10n**30n])cases.push({m,n,expected:periodic(n,m)});
}
let programs=0;
for(const mode of ['reference','compiled','exact']){
 const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'});
 try{
  r.execute(source.slice(source.indexOf('fun N pairs M')));
  for(const {m,n,expected}of cases){r.variables.set('NValue',n);r.variables.set('MValue',BigInt(m));assert.equal(r.execute('NValue pairs MValue'),expected,`${mode}/${n}/${m}`);programs++;}
 }finally{r.dispose()}
}
console.log(JSON.stringify({programs,cases:cases.length,failures:0}));
