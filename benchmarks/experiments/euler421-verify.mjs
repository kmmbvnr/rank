import {readFileSync} from 'node:fs';
const {Interpreter}=await import(process.env.RANK421_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const cases=[[0,20],[1,2],[2,10],[2,3],[3,5],[10,0],[10,1],[10,2],[10,3],[10,5],[10,20],[25,50],[200,1000],[1000,5000]];
const primes=[];for(let p=2;p<=5000;p++)if(primes.every(q=>q*q>p||p%q!==0))primes.push(p);
const expected=cases.map(([n,m])=>{
 let total=0n;for(let x=1;x<=n;x++){const value=BigInt(x)**15n+1n;for(const p of primes){if(p>m)break;if(value%BigInt(p)===0n)total+=BigInt(p);}}return total;
});
const variants=['original','builtin','order','sum','scalar','ranked','batched','periodic'];
let checked=0;
for(const variant of variants){const source=readFileSync(new URL(`./euler421-${variant}.ra`,import.meta.url),'utf8');
 for(const compilation of [false,true])for(let i=0;i<cases.length;i++){
  const [n,m]=cases[i],runtime=new Interpreter(()=>{},{compilation,args:[`--n=${n}`,`--m=${m}`]});
  try{runtime.execute(source);const answer=(runtime.variables.get('Answer') ?? runtime.lastResult);if(answer!==expected[i])throw Error(JSON.stringify({variant,compilation,n,m,expected:String(expected[i]),answer:String(answer)}));checked++;}finally{runtime.dispose();}
 }
}
console.log(JSON.stringify({checked,variants,oracle:'direct positive x enumeration and exact divisibility of x^15+1',cases:cases.map(([n,m],i)=>({n,m,answer:String(expected[i])}))}));
