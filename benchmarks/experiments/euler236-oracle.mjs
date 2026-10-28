import assert from 'node:assert/strict';
const gcd=(a,b)=>{while(b){[a,b]=[b,a%b]}return a};
let viable=0,checks=0,answer=[1,1],solutions=[];
const stockA=[5248,1312,2624,5760,3936],stockB=[640,1888,3776,3776,5664],groups=[0,1,1,2,1],gb=[5,59,59],ga=[41,41,90];
for(let a=1;a<=5248;a++)for(let b=1;b<=640;b++){
 if(41*b<=5*a||gcd(a,b)!==1)continue;
 let u=41*b,v=5*a,g=gcd(u,v);u/=g;v/=g;
 const n=[],d=[],lo=[1,3,1],hi=[0,0,0];
 for(let j=0;j<3;j++){g=gcd(u*gb[j],v*ga[j]);n[j]=u*gb[j]/g;d[j]=v*ga[j]/g}
 let ok=true;
 for(let i=0;i<5;i++){const j=groups[i],bound=Math.min(Math.floor(stockA[i]/d[j]),Math.floor(stockB[i]/n[j]));hi[j]+=bound;if(bound<1)ok=false}
 if(!ok)continue;viable++;
 let c=d.map((x,j)=>BigInt(v)*15744n*BigInt(x)-BigInt(u)*18880n*BigInt(n[j]));
 const bgcd=(a,b)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b){[a,b]=[b,a%b]}return a};g=bgcd(bgcd(c[0],c[1]),c[2]);c=c.map(x=>Number(x/g));
 if(!c.every(Number.isSafeInteger))throw Error('wide');
 let found=false;
 for(let s0=lo[0];s0<=hi[0]&&!found;s0++)for(let s2=lo[2];s2<=hi[2];s2++){
  checks++;const r=-c[0]*s0-c[2]*s2;if(!Number.isSafeInteger(r))throw Error('wide sum');
  if(c[1]===0)throw Error('zero coefficient');
  if(r%c[1]===0&&r/c[1]>=lo[1]&&r/c[1]<=hi[1]){found=true;break}
 }
 if(found){solutions.push([u,v]);if(u*answer[1]>answer[0]*v)answer=[u,v]}
}
assert.equal(solutions.length,35);
assert.deepEqual(answer,[123,59]);
console.log(JSON.stringify({viable,checks,count:solutions.length,answer,solutions}));
