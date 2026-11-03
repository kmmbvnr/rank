import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
const{Interpreter}=await import(process.env.RANK351_RUNTIME||new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const top=1000000,phi=new Uint32Array(top+1),sums=new Float64Array(top+1);for(let i=0;i<=top;i++)phi[i]=i;
for(let p=2;p<=top;p++)if(phi[p]===p)for(let v=p;v<=top;v+=p)phi[v]-=phi[v]/p;
for(let i=1;i<=top;i++)sums[i]=sums[i-1]+phi[i];
const ns=new Set(Array.from({length:301},(_,i)=>i));
for(const n of [999,1000,1001,9999,10000,10001,65535,65536,65537,100000,100001,100003,250000,999983,1000000])ns.add(n);
let seed=1234567;for(let i=0;i<20;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;ns.add(1+seed%100000);}
let checks=0;
const variants=process.env.RANK351_VARIANTS?.split(',')||['original','inline','balanced','balanced-scan','tail100k','keyx','selected'];
for(const file of variants)for(const compilation of [false,true]){
 const src=readFileSync(new URL(`./experiments/euler351-${file}.ra`,import.meta.url),'utf8'),r=new Interpreter(()=>{},{compilation});
 try{r.execute(src.slice(0,src.indexOf('\nAnswer =')));
 for(const n of ns){const expected=6n*(BigInt(n)*BigInt(n+1)/2n-BigInt(sums[n]));assert.equal(r.execute(`${n} hidden`),expected,`${file} ${compilation} ${n}`);checks++;}
 }finally{r.dispose();}
}
console.log(JSON.stringify({checks,inputs:ns.size,variants,engines:[false,true],oracle:'direct totient sieve through 1e6'}));
