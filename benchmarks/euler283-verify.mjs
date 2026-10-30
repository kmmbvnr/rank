import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../packages/interpreter/out/index.js';
// Independent small-input oracle: enumerate X,Y directly, without factoring or divisors.
function oracle(top){
  let total=0n;
  for(let k=1;k<=top;k++){
    const r=2*k,q=r*r;
    for(let x=1;x*x<=3*q;x++){
      const hi=Math.floor((q+Math.floor(Math.sqrt(q*(x*x+q))))/x);
      for(let y=Math.max(x,Math.floor(q/x)+1);y<=hi;y++){
        const d=x*y-q,n=q*(x+y);
        if(n%d!==0)continue;
        const z=n/d;if(z<y)continue;
        const a=BigInt(x+y),b=BigInt(x+z),c=BigInt(y+z),s=BigInt(x+y+z);
        assert.equal(s*(s-a)*(s-b)*(s-c),BigInt(k*k)*(2n*s)**2n);
        total+=2n*s;
      }
    }
  }
  return String(total);
}
const limits=[0,1,2,3,4,5,7,10,15,20,25,50,100];
const variants=['original','safe','capped','pruned','hoisted','congruent','reduced','shipping'];
const expected=Object.fromEntries(limits.map(top=>[top,oracle(top)]));
let comparisons=0;
for(const variant of variants){
  const original=readFileSync(new URL(variant==='shipping'?'../demos/euler/283_integertriangles.ra':`./experiments/euler283-${variant}.ra`,import.meta.url),'utf8');
  for(const scenario of ['compiled','reference','wide-seed'])for(const top of limits){
    const r=new Interpreter(()=>{},{compilation:scenario!=='reference'});
    let source=original.replace('arg Top integer = 1000',`arg Top integer = ${top}`);
    if(scenario==='wide-seed')source=source.replace('Total = 0','Total = 9007199254740992').replace('Answer = Total','Answer = Total - 9007199254740992');
    try{r.execute(source);assert.equal(String(r.variables.get('Answer')),expected[top],`${variant}/${scenario}/${top}`);comparisons++;}finally{r.dispose()}
  }
}
console.log(JSON.stringify({comparisons,variants,limits,expected}));
