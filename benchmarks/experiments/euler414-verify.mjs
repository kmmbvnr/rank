import {readFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
import {source} from './euler414-variants.mjs';
const original=source('original'),triangle=source('triangle'),four=source('four');
const delivered=readFileSync(new URL('../../demos/euler/414_kaprekar.ra',import.meta.url),'utf8');
const cases=[[2,5274369n],[18,400668930299n],[40,40372025866559n],[100,9032180012980999n]];
let checked=0;
for(const compilation of [false,true])for(const source of [original,triangle,four,delivered])for(const [k,expected] of cases){
 const r=new Interpreter(()=>{},{compilation,args:[`--first=${k}`,`--last=${k}`]});
 try{r.execute(source);const answer=r.variables.get('Answer');if(answer!==expected)throw Error(`${compilation} ${k}: ${answer}`);checked++;}finally{r.dispose();}
}
for(const compilation of [false,true])for(const variant of ['original','triangle','combined'])for(const [first,last,mod,expected] of [[2,1,1000000,0n],[2,2,1,0n],[40,40,1000000,866559n]]){
 const r=new Interpreter(()=>{},{compilation,args:[`--first=${first}`,`--last=${last}`,`--mod=${mod}`]});
 try{r.execute(source(variant));if(r.variables.get('Answer')!==expected)throw Error('modulus/empty range');checked++;}finally{r.dispose();}
}
// Independent sorted five-digit tuples and their multinomial weights.
// Decimal subtraction in base b supplies the actual routine transition.
for(const b of [15,21,27]){
 const constant=(2*b/3)*b+b/3,weights=new Map(),depth=new Map([[constant,1]]);
 const state=digits=>{const a=[...digits].sort((a,b)=>a-b);return [a[4]-a[0],a[3]-a[1]];};
 const next=(u,v)=>{
  const value=u*(b**4-1)+v*(b**3-b);let t=value,a=[];
  for(let i=0;i<5;i++){a.push(t%b);t=Math.floor(t/b);}return state(a);
 };
 const distance=(u,v)=>{const key=u*b+v;if(depth.has(key))return depth.get(key);const [x,y]=next(u,v),d=1+distance(x,y);depth.set(key,d);return d;};
 for(let a=0;a<b;a++)for(let c=a;c<b;c++)for(let d=c;d<b;d++)for(let e=d;e<b;e++)for(let f=e;f<b;f++){
  const digits=[a,c,d,e,f],freq=new Map();for(const n of digits)freq.set(n,(freq.get(n)??0)+1);
  const fact=[1,1,2,6,24,120];let count=120;for(const n of freq.values())count/=fact[n];
  const [u,v]=state(digits);if(!u)continue;const key=u*b+v;weights.set(key,(weights.get(key)??0)+count);
 }
 let total=0n;
 for(let u=1;u<b;u++)for(let v=0;v<=u;v++){
  let mu=100+120*(v-1)+120*v*(u-v-1);if(u===v)mu=20+30*(u-1);if(!v)mu=10+20*(u-1);
  if(weights.get(u*b+v)!==mu*(b-u))throw Error('multiplicity');
  total+=BigInt(weights.get(u*b+v)*distance(u,v));
  // Four-digit order-statistics prototype.
  const low=Math.min(b-u,u),high=Math.max(b-u,u),left=b-1-v,right=v-1;
  const small=Math.min(left,right),large=Math.max(left,right);
  const x=v?b-1-Math.min(low,small):b-1-Math.min(b-u,u-1);
  const y=v?Math.max(high,large)-Math.min(Math.max(low,small),Math.min(high,large)):b-1-Math.max(b-u,u-1);
  const expected=next(u,v);if(x!==expected[0]||y!==expected[1])throw Error('transition');
 }
 const r=new Interpreter(()=>{},{args:[`--first=${(b-3)/6}`,`--last=${(b-3)/6}`]});
 try{r.execute(original);if(r.variables.get('Answer')!==total-1n)throw Error('oracle total');}finally{r.dispose();}
 console.log(JSON.stringify({b,total:String(total-1n),states:weights.size}));
}
console.log(JSON.stringify({checked}));
