import {readFileSync} from 'node:fs';
const {Interpreter}=await import(process.env.RANK416_RUNTIME??new URL('../../packages/interpreter/out/index.js',import.meta.url));
const source=readFileSync(process.argv[2]??new URL('./euler416-original.ra',import.meta.url),'utf8');
const modulus=1000000000n;
// Enumerate each one-way route, then union visit masks for the 2m legs.
// Direction reversal preserves the set of possible visited squares.
function oracle(m,n){
 const trips=new Map();
 function visit(x,mask){
  if(x===n-1){trips.set(mask,(trips.get(mask)??0n)+1n);return;}
  for(let step=1;step<=3;step++)if(x+step<n)visit(x+step,mask|1<<(x+step));
 }
 visit(0,1);
 let states=new Map([[1,1n]]);
 for(let leg=0;leg<2*m;leg++){
  const next=new Map();
  for(const [a,count]of states)for(const [b,ways]of trips)next.set(a|b,(next.get(a|b)??0n)+count*ways);
  states=next;
 }
 let answer=0n;
 for(const [mask,ways]of states){let bits=0;for(let v=mask;v;v>>>=1)bits+=v&1;if(bits>=n-1)answer+=ways;}
 return answer%modulus;
}
const cases=[];for(const m of [1,2,3])for(let n=2;n<=8;n++)cases.push([m,n,oracle(m,n)]);
cases.push([2,100,429619151n]);
let checked=0;
for(const compilation of [false,true])for(const [m,n,expected]of cases){
 const runtime=new Interpreter(()=>{},{compilation,args:[`--m=${m}`,`--n=${n}`]});
 try{runtime.execute(source);const actual=runtime.variables.get('Answer');if(actual!==expected)throw Error(JSON.stringify({compilation,m,n,expected:String(expected),actual:String(actual)}));checked++;}finally{runtime.dispose();}
}
console.log(JSON.stringify({checked,smallCases:21,statementCheckpoint:true}));
