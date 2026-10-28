import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {Interpreter}=await import(pathToFileURL(resolve(process.argv[2]??'packages/interpreter/out/index.js')));
const {sources}=JSON.parse(readFileSync(new URL('../baselines/2026-10-28-euler229-investigation.json',import.meta.url),'utf8'));
sources.shipping=readFileSync(new URL('../../demos/euler/229_foursquares.ra',import.meta.url),'utf8');
const limits=[0,1,15,16,49,99,100,120,121,167,168,169,192,193,194,999,1000,3600,9999,10000,100000,1000000];
const top=Math.max(...limits);const mask=new Uint8Array(top+1);
for(const [i,d]of [1,2,3,7].entries())for(let a=1;a*a+d<=top;a++)for(let b=1;a*a+d*b*b<=top;b++)mask[a*a+d*b*b]|=1<<i;
const counts=new Uint32Array(top+1);for(let n=1;n<=top;n++)counts[n]=counts[n-1]+ +(mask[n]===15);
let checked=0;
for(const file of ['original','factors','compact','shipping'])for(const compilation of [true,false])for(const limit of limits){
 const r=new Interpreter(()=>{},{compilation});
 try{r.execute(sources[file].replace(/option Limit integer = \d+/,`option Limit integer = ${limit}`));assert.equal(String(r.variables.get('Answer')),String(counts[limit]),`${file} ${compilation} ${limit}`);checked++;}finally{r.dispose();}
}
console.log(JSON.stringify({checked,limits,answers:limits.map(x=>counts[x])}));

const rt=44721;
const sp=new Int32Array(rt+1);
for(let p=2;p<=rt;p++)if(!sp[p])for(let j=p;j<=rt;j+=p)if(!sp[j])sp[j]=p;
const flags=Array.from({length:4},()=>new Uint8Array(rt+1));
for(let m=1;m<=rt;m++){
 let v=m;flags[2][m]=+(m%2===0);flags[3][m]=+(m%4===0);
 while(v>1){const p=sp[v];if(p%4===1)flags[0][m]=1;if([1,3].includes(p%8))flags[1][m]=1;if(p%3===1)flags[2][m]=1;if(p!==2&&[1,2,4].includes(p%7))flags[3][m]=1;while(v%p===0)v/=p;}
}
// Direct integer-square enumeration, no prime-class criterion.
const squareTop=5000;
for(const [di,d] of [1,2,3,7].entries()){
 const brute=new Uint8Array(squareTop+1);
 for(let a=1;a<squareTop;a++)for(let b=1;a*a+d*b*b<=squareTop*squareTop;b++){
  const n=a*a+d*b*b,m=Math.floor(Math.sqrt(n));if(m*m===n)brute[m]=1;
 }
 for(let m=0;m<=squareTop;m++)assert.equal(flags[di][m],brute[m],`d=${d} m=${m}`);
}
console.log(JSON.stringify({checked:4*(squareTop+1),rt,squareCount:flags[0].reduce((n,x,i)=>n+(x&&flags[1][i]&&flags[2][i]&&flags[3][i]?1:0),0)}));


const original=sources.original;
const s='use numbers\nuse sequences\nLimit = 2000000000\nRt = Limit isqrt\n'+original.slice(original.indexOf('Sp = array'),original.indexOf('T0 = Tab'));
const r=new Interpreter(()=>{});let squareChecked=0;
try{r.execute(s);const tab=r.variables.get('Tab');for(let d=0;d<4;d++)for(let m=0;m<=44721;m++){const ix=d*44722+m;const value=tab.itemAt?tab.itemAt(ix):tab.items[ix];assert.equal(Number(value),flags[d][m],`d=${d} m=${m}`);squareChecked++;}console.log(JSON.stringify({squareChecked}));}finally{r.dispose();}
