import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {Interpreter}=await import(process.env.RANK346_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
// Independent oracle: inspect every number's base digits.
function qualifies(n) {
  if(n===1)return true;
  for(let b=2;b*b+b+1<=n;b++) {
    let v=n,digits=0;
    while(v>0 && v%b===1){v=Math.floor(v/b);digits++;}
    if(v===0 && digits>=3)return true;
  }
  return false;
}
const max=100000, sums=[0];
for(let n=1;n<max;n++)sums[n]=sums[n-1]+(qualifies(n)?n:0);
const limits=new Set(Array.from({length:512},(_,i)=>i+1));
for(const n of [7,15,31,40,8191,9991])for(let d=-1;d<=1;d++)limits.add(n+d);
let seed=346;
for(let i=0;i<100;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;limits.add(1+seed%(max-1));}
let checks=0;
for(const file of ['original','split','generator','delivered'])for(const compilation of [true,false]) {
  const location=file==='delivered'?'../demos/euler/346_strongrepunits.ra':`experiments/euler346-${file}.ra`;
  const source=readFileSync(new URL(location,import.meta.url),'utf8');
  const body=source.slice(0,source.lastIndexOf('\nLimit strong print'));
  const normalized=(file==='original'||file==='delivered')?source.slice(0,source.indexOf('\nAnswer =')):body;
  const outputs=[];const r=new Interpreter(t=>outputs.push(t.trim()),{compilation});
  try {
    r.execute(normalized+'\n'+[...limits].map(n=>`${n} strong print`).join('\n'));
    assert.equal(outputs.length,limits.size);
    let i=0;for(const n of limits){if(file==='original'&&n===1){assert.equal(outputs[i++],'1');continue;}assert.equal(outputs[i++],String(sums[n-1]),`${file} ${compilation} Limit=${n}`);checks++;}
  }finally{r.dispose();}
}
console.log(JSON.stringify({checks,limits:limits.size,maxOracle:max-1,oracle:'inspect base digits for each integer',passed:true}));
