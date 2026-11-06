import {readFileSync} from 'node:fs';
const {Interpreter}=await import(process.env.RANK421_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const primes=[2n,3n,5n,7n,11n,13n,17n,19n,23n,29n,31n];
const bounds=[9007199254740991n,9007199254740993n,10n**30n];
const variants=['original','builtin','order','sum','scalar','ranked','batched','periodic'];
let checked=0;
for(const n of bounds){
 // Enumerate all residues directly, not a primitive-root/order construction.
 let expected=0n;for(const p of primes)for(let x=1n;x<p;x++)if((x**15n+1n)%p===0n)expected+=p*((n+p-x)/p);
 for(const variant of variants)for(const compilation of [false,true]){
  const runtime=new Interpreter(()=>{},{compilation,args:[`--n=${n}`,'--m=31']});
  try{runtime.execute(readFileSync(new URL(`./euler421-${variant}.ra`,import.meta.url),'utf8'));const answer=runtime.variables.get('Answer');if(answer!==expected)throw Error(JSON.stringify({n:String(n),variant,compilation,expected:String(expected),answer:String(answer)}));checked++;}finally{runtime.dispose();}
 }
}
console.log(JSON.stringify({checked,bounds:bounds.map(String),oracle:'direct roots modulo every prime up to 31; exact period counts'}));
