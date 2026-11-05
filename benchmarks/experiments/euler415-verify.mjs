import {sourceFor} from './euler415-variants.mjs';
import {Interpreter} from '../../packages/interpreter/out/index.js';
const files=['original','combined','scoped','delivered'];
const mod=100000000n;
const gcd=(a,b)=>{a=Math.abs(a);b=Math.abs(b);while(b)[a,b]=[b,a%b];return a;};
// Independent geometric oracle: enumerate grid lines, count their points,
// and subtract all collinear subsets of size >= 3 from all point subsets.
function oracle(n){
 const points=[];for(let x=0;x<=n;x++)for(let y=0;y<=n;y++)points.push([x,y]);
 const lines=new Map();
 for(let i=0;i<points.length;i++)for(let j=0;j<i;j++){
  let a=points[i][1]-points[j][1],b=points[j][0]-points[i][0];const d=gcd(a,b);a/=d;b/=d;
  if(a<0||(a===0&&b<0)){a=-a;b=-b;}const c=a*points[i][0]+b*points[i][1];lines.set(`${a},${b},${c}`,[a,b,c]);
 }
 let excluded=1n+BigInt(points.length);
 for(const [a,b,c] of lines.values()){
  const k=points.filter(([x,y])=>a*x+b*y===c).length;
  if(k>=3)excluded+=(1n<<BigInt(k))-1n-BigInt(k)-BigInt(k*(k-1)/2);
 }
 return ((1n<<BigInt(points.length))-excluded)%mod;
}
const cases=Array.from({length:8},(_,i)=>[i+1,1,String(oracle(i+1))]);
cases.push([111,30,'13500401'],[100000,400,'63259062']);
let checked=0;
for(const file of files)for(const compilation of [false,true])for(const [n,l,expected] of cases){
 const runtime=new Interpreter(()=>{},{compilation,args:[`--n=${n}`,`--l=${l}`]});
 try{runtime.execute(sourceFor(file));const answer=String(runtime.variables.get('Answer'));if(answer!==expected)throw Error(JSON.stringify({file,compilation,n,l,expected,answer}));checked++;}finally{runtime.dispose();}
}
console.log(JSON.stringify({checked,oracle:cases.slice(0,8),files}));
