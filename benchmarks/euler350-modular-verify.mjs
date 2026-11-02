import assert from 'node:assert/strict';
const {Interpreter,RuntimeDiagnostics,RankError}=await import(process.env.RANK350_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
let checks=0, entries=0;
const limit=9007199254740991n;
const operands=[-limit,-1073741825n,-104060401n,-1n,0n,1n,104060400n,1073741823n,limit];
const moduli=[-104060401n,0n,1n,2n,101n,104060401n,1073741823n,1073741824n,1073741825n];
const r=new Interpreter(()=>{}, {scalarFunctionCompilation:false});
try{
 for(const a of operands)for(const b of operands)for(const m of moduli){
  r.execute(`A = ${a}\nB = ${b}\nM = ${m}\nResult = 0`);
  const d=new RuntimeDiagnostics();
  const run=()=>d.run(()=>r.execute('for I in 0 to 100\n Result = A * B mod M\nend\nResult'));
  if(m===0n)assert.throws(run,/division by zero/);
  else{const p=a*b;let value=p%m;if(value!==0n&&(p<0n)!==(m<0n))value+=m;assert.equal(run(),value,`${a} * ${b} mod ${m}`);}
  if(m>0n&&m<=1073741824n)assert.equal(d.numberLoopOverflows,0,`bounded product must not replay: ${a},${b},${m}`);
  entries+=d.numberLoops;checks++;
 }
}finally{r.dispose();}
assert.ok(entries>0,'prototype must actually execute Number loops');
console.log(JSON.stringify({checks,numberEntries:entries,oracle:'BigInt signed floor remainder',domain:'safe signed operands; modulus around zero and 2^30'}));
