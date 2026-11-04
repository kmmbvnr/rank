import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const files=['demos/euler/407_idempotents.ra','benchmarks/experiments/euler407-powmod.ra','benchmarks/experiments/euler407-no-copy.ra','benchmarks/experiments/euler407-lazy.ra','benchmarks/experiments/euler407-private.ra','benchmarks/experiments/euler407-incremental.ra'];
const limits=[2,3,4,6,8,9,12,25,36,49,64,100,209,1000];
let checks=0;
for(const n of limits){let expected=0;for(let k=2;k<=n;k++){let m=0;for(let a=0;a<k;a++)if(a*a%k===a)m=a;expected+=m;}
 for(const file of files)for(const compilation of [false,true]){const r=new Interpreter(()=>{},{compilation,args:[`--n=${n}`]});try{r.execute(readFileSync(file,'utf8'));const answer=String(r.variables.get('Answer'));if(answer!==String(expected))throw Error(JSON.stringify({file,n,compilation,answer,expected}));checks++;}finally{r.dispose();}}
}
console.log(JSON.stringify({checks,limits,files}));
