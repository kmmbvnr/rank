import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';

// Independent finite game: the first binary integer with popcount n+1
// creates a gap larger than any legal move. No later counter is reachable.
function game(n) {
  const positions=[0]; let total=0;
  for(let k=1;;k++) {
    let x=k,bits=0;while(x){bits+=x&1;x>>>=1;}
    if(bits>n)break;
    total+=bits;positions.push(total);
  }
  const winning=new Uint8Array(total+1);
  for(let i=positions.length-2;i>=0;i--) {
    const here=positions[i];
    for(let j=i+1;j<positions.length && positions[j]-here<=n;j++) {
      if(!winning[positions[j]]){winning[here]=1;break;}
    }
  }
  let move=0;
  for(let i=1;i<positions.length && positions[i]<=n;i++)
    if(!winning[positions[i]])move=positions[i];
  return move;
}
const moves=Array.from({length:14},(_,i)=>game(i+1));
const files=['demos/euler/391_hopping.ra',...['original','banks','grow','compact','vector','bank-vector'].map(v=>`benchmarks/experiments/euler391-${v}.ra`)];
let cases=0;
for(const file of files)for(const compilation of [false,true]) {
  const source=readFileSync(file,'utf8');
  const output=[];
  const r=new Interpreter(s=>output.push(String(s)),{compilation,args:['--limit=14']});
  try {
    r.execute(source.replace('Answer += Val ** 3','Val print\n      Answer += Val ** 3'));
    assert.deepEqual(output.slice(0,14).map(Number),moves,`${file}, compiled=${compilation}`);
    assert.equal((r.variables.get('Answer') ?? r.lastResult),moves.reduce((s,v)=>s+BigInt(v)**3n,0n));
    cases+=14;
  }finally{r.dispose();}
  for(const [limit,answer] of [[0,0n],[2,8n],[7,90n],[20,8150n]]) {
    const check=new Interpreter(()=>{},{compilation,args:[`--limit=${limit}`]});
    try {check.execute(source);assert.equal((check.variables.get('Answer') ?? check.lastResult),answer,`${file}, limit=${limit}`);cases++;}
    finally{check.dispose();}
  }
}
console.log(JSON.stringify({cases,moves,files,engines:['reference','compiled']}));
