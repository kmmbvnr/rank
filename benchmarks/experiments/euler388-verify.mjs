import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
function gcd(a,b){while(b){[a,b]=[b,a%b];}return a;}
function brute(n){let total=0n;for(let a=0;a<=n;a++)for(let b=0;b<=n;b++)for(let c=0;c<=n;c++)if(gcd(gcd(a,b),c)===1)total++;return total;}
function mobius(n){let sign=1;for(let p=2;p*p<=n;p++){if(n%p)continue;n/=p;sign=-sign;if(n%p===0)return 0;while(n%p===0)n/=p;}return n>1?-sign:sign;}
function direct(n){let total=0n;for(let d=1;d<=n;d++){const q=BigInt(Math.floor(n/d));total+=BigInt(mobius(d))*((q+1n)**3n-1n);}return total;}
let comparisons=0;
for(const variant of ['original','carry','direct','original-scan','strided-table','strided-table-primearray','delivered']){
 const source=readFileSync(new URL(variant==='delivered'?'../../demos/euler/388_lines.ra':`euler388-${variant}.ra`,import.meta.url),'utf8');
 for(const compilation of [false,true]){

   for(const n of [0,1,2,3,4,6,7,8,10,15,40,99,100,127,256,1000]){
    const expected=direct(n);if(n<=15)assert.equal(expected,brute(n));
    for(const cut of [...new Set([1,Math.max(1,Math.floor(Math.sqrt(n))),Math.max(1,n)])]){
     const r=new Interpreter(()=>{},{compilation});
     try { r.execute(source.replace('arg N integer = 10 ** 10',`N = ${n}`).replace('arg Cut integer = 4641589',`Cut = ${cut}`));
     assert.equal(r.variables.get('Answer'),expected,`${variant}/${compilation}/N=${n}/Cut=${cut}`); comparisons++; } finally { r.dispose(); }
    }
   }
 }
}
console.log(JSON.stringify({comparisons,oracle:'direct trial-factorization Mobius sum, cross-checked by exhaustive 3D gcd for N<=15'}));
