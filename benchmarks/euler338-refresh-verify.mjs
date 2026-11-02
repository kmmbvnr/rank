import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK338_RUNTIME||new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const variant=process.argv[2]||'inline';
const source=readFileSync(new URL(variant==='production'?'../demos/euler/338_gridpaper.ra':`experiments/euler338-refresh-${variant}.ra`,import.meta.url),'utf8').replace('arg Limit integer = 1000000000000','').replace('Limit grid print','');
function oracle(n){let total=0n;for(let i=2;i<=n;i++){const q=Math.floor(n/i);let d=0;for(let j=1;j<=q;j++)d+=Math.floor(q/j);total+=BigInt(q)*BigInt(Math.floor(n/(i-1)))-BigInt(d)}return total}
const cases=new Set([-100,-1,...Array.from({length:301},(_,i)=>i)]);
for(const boundary of [343,512,729,1000])for(const delta of [-1,0,1])cases.add(boundary+delta);
for(const compilation of [true,false]) {
 const r=new Interpreter(()=>{},{compilation});const d=new RuntimeDiagnostics();
 try{r.execute(source);d.run(()=>{for(const n of cases){r.execute(`Actual = ${n} grid`);assert.equal(r.variables.get('Actual'),oracle(n),`${variant}/${compilation}/${n}`)}});
 console.log(JSON.stringify({variant,compilation,checks:cases.size,numberLoops:d.numberLoops,overflows:d.numberLoopOverflows}));}finally{r.dispose()}
}
// Compare the experimental direct range fold with the reference evaluator.
const ranges=[['1','9',undefined],['9','1','-2'],['-4','5','3'],['1','0',undefined],['0','0',undefined],['-1','1',undefined],['9007199254740989','9007199254740991',undefined],['9007199254740991','9007199254740993',undefined]];
let checks=0;
for(const [lo,hi,step] of ranges)for(const operator of ['to','till'])for(const n of ['0','17','-17','9007199254740991']) {
 const program=`fun N sample\n S = 0\n for J in 1 to 2\n  S += (N // (${lo} ${operator} ${hi}${step?' by '+step:''})) sum\n end\n return S\nend\nActual = ${n} sample`;
 const run=compilation=>{const r=new Interpreter(()=>{},{compilation});try{r.execute(program);return {value:r.variables.get('Actual')}}catch(e){return {error:e.message}}finally{r.dispose()}};
 assert.deepEqual(run(true),run(false),program);checks++;
}
console.log(JSON.stringify({rangeFoldBoundaryChecks:checks}));
