import {readFileSync,writeFileSync} from 'node:fs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const oracle=(N)=>{
 let total=0n;
 for(let a=1n;a<=N;a++)for(let b=a+1n;b<2n*a;b++){
  const num=4n*a*a*b*b,den=5n*b*b-4n*a*a;
  if(num%den)continue;
  const square=num/den;let c=BigInt(Math.floor(Math.sqrt(Number(square))));
  while((c+1n)*(c+1n)<=square)c++;
  while(c*c>square)c--;
  if(c*c===square && b<c && c<2n*a)total++;
 }
 return total;
};
const limits=[0,1,208,209,210,500,1000];
const expected=new Map(limits.map(n=>[n,oracle(BigInt(n))]));
expected.set(10000,106n);expected.set(1000000,11845n);
const names=['original','bounded','scalar-bounded','count-first','selected','original-divide','selected-divide'];
let comparisons=0;
for(const name of names)for(const compilation of [false,true])for(const [N,want]of expected){
 const r=new Interpreter(()=>{},{compilation,args:[`--n=${N}`]});
 try{
  r.execute(readFileSync(`benchmarks/experiments/euler404-${name}.ra`,'utf8'));
  const got=r.variables.get('Answer');
  if(got!==want)throw Error(`${name}/${compilation}/${N}: ${got} != ${want}`);
  comparisons++;
 }finally{r.dispose();}
}
const result={comparisons,limits:Object.fromEntries([...expected].map(([n,v])=>[n,String(v)])),oracle:'direct enumeration of a,b,c; rational c squared and exact integer square check'};
console.log(JSON.stringify(result));
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
