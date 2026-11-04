import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const production=readFileSync(new URL('../../demos/euler/397_parabola.ra',import.meta.url),'utf8');
const source=readFileSync(new URL('./euler397-pruned.ra',import.meta.url),'utf8');
const compact=readFileSync(new URL('./euler397-compact.ra',import.meta.url),'utf8');
const original=readFileSync(new URL('./euler397-original.ra',import.meta.url),'utf8');
function brute(K,X){let count=0;for(let k=1;k<=K;k++)for(let a=-X;a<=X;a++)for(let b=a+1;b<=X;b++)for(let c=b+1;c<=X;c++){
 if(k*k+(a+b)*(a+c)===k*(c-b)||-(k*k+(a+b)*(b+c))===k*(c-a)||k*k+(a+c)*(b+c)===k*(b-a))count++;
}return BigInt(count);}
let cases=0;
for(const compilation of [false,true]){
 const r=new Interpreter(()=>{},{compilation,loadModule:name=>({id:name,source:name==='original'?original:name==='compact'?compact:name==='production'?production:source})});
 try{r.execute('use "original"\nuse "pruned"');
 for(const [K,X] of [[0,5],[1,0],[1,1],[1,10],[2,3],[3,5],[8,7],[10,10],[25,12],[30,1],[100,15]]){
  for(const name of ['original','pruned','compact','production']){r.execute(`use "${name}"\nK = ${K}\nX = ${X}\nrun`);assert.equal(r.variables.get('Answer'),brute(K,X),`${compilation} ${name} ${K} ${X}`);cases++;}
 }
 for(const name of ['original','pruned','compact','production']){r.execute(`use "${name}"\nK = 1\nX = 10 ** 20\nrun`);assert.equal(r.variables.get('Answer'),400000000000000000001n);cases++;}
 }finally{r.dispose();}
}
// Independently verify the proposed buffer bound for every supported N.
const K=1000000,spf=new Uint32Array(K+1);let max=0,at=0;
for(let p=2;p<=K;p++)if(!spf[p])for(let n=p;n<=K;n+=p)if(!spf[n])spf[n]=p;
for(let n=1;n<=K;n++){
 let rest=n,count=2;
 while(rest>1){const p=spf[rest];let e=0;do{rest/=p;e++;}while(rest>1&&spf[rest]===p);count=p===2?2*e+2:count*(2*e+1);}
 assert(count<8*(Math.floor(Math.sqrt(n))+1));
 if(count>max){max=count;at=n;}
}
console.log(JSON.stringify({cases,bufferBoundInputs:K,maxDivisors:max,at}));
