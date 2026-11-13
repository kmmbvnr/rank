import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {oracle,interval} from './euler328-oracle.mjs';
const root=process.env.RANK_ROOT||fileURLToPath(new URL('../..',import.meta.url));
const {Interpreter}=await import(`${root}/packages/interpreter/out/index.js`);
const {readArrayItem}=await import(`${root}/packages/interpreter/out/runtime/array-storage.js`);
const n=Number(process.argv[2]||200000),mode=process.argv[3]||'compiled',variant=process.argv[4]||'frontier';
const expected=oracle(n);if(n>=256){const independent=interval(256);for(let i=1;i<=256;i++)assert.equal(expected.dp[i],independent[i]);}
const source=readFileSync(new URL(variant==='final'?'../../demos/euler/328_lowestcost.ra':`./euler328-${variant}.ra`,import.meta.url),'utf8').replace('Answer = 200000 costs',`Answer = ${n} costs`).replace('  return Sum','  return Dp');
const r=new Interpreter(()=>{},{compilation:mode!=='reference',numberLoopCompilation:mode!=='exact'});let sum=0;
try{r.execute(source);const dp=(r.variables.get('Answer') ?? r.lastResult);for(let i=0;i<=n;i++){const got=readArrayItem(dp,i);assert.equal(got,BigInt(expected.dp[i]),`N=${n} i=${i} ${mode} ${variant}`);sum+=Number(got);}assert.equal(sum,expected.sum);
console.log(JSON.stringify({n,mode,variant,cells:n+1,independentIntervals:Math.min(n,256),sum,oracleCandidates:expected.visits,failures:0}));}finally{r.dispose()}
