import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {Interpreter,RuntimeDiagnostics}=await import(process.env.RANK341_RUNTIME || new URL('../packages/interpreter/out/index.js',import.meta.url).href);
const body=variant=>readFileSync(new URL(variant==='production'?'../demos/euler/341_golomb.ra':`experiments/euler341-${variant}.ra`,import.meta.url),'utf8').replace(/arg Count integer = \d+/,'').replace('Count cubes print','');
// Independent oracle: compute g(n) directly up to the largest small cube.
const values=new Int32Array(1000001);values[1]=1;
for(let n=2;n<values.length;n++) values[n]=1+values[n-values[values[n-1]]];
const expected=[0n,0n];let sum=0n;
for(let count=2;count<=101;count++){sum+=BigInt(values[(count-1)**3]);expected[count]=sum;}
for(const compilation of [true,false]) {
 for(const variant of process.argv[2]?[process.argv[2]]:['original','stream','runs','blocks','blocks-index']) {
  const r=new Interpreter(()=>{},{compilation});
  try {r.execute(body(variant));
   for(let count=1;count<=101;count++){r.execute(`Actual = ${count} cubes`);assert.equal(r.variables.get('Actual'),expected[count],`${variant}/${compilation}/${count}`)}
   for(const [count,gold] of [[1000,153506976n]]){r.execute(`Actual = ${count} cubes`);assert.equal(r.variables.get('Actual'),gold)}
   console.log(JSON.stringify({variant,compilation,checks:102,oracle:'direct Golomb recurrence at each cube plus fixture golden'}));
  }finally{r.dispose()}
 }
}
// Cross-check the compressed algorithm at larger inputs, independently of its
// triangular inversion, using the existing per-index weighted-prefix walk.
for(const count of [127,256,999,1001,10000]) {
 const answers=[];
 for(const compilation of [true,false])for(const variant of ['original',process.argv[2]||'blocks-index']){
  const r=new Interpreter(()=>{},{compilation});try{r.execute(body(variant)+`\nActual = ${count} cubes`);answers.push(r.variables.get('Actual'))}finally{r.dispose()}
 }
 for(const answer of answers)assert.equal(answer,answers[0]);
 console.log(JSON.stringify({largerCount:count,answer:String(answers[0]),engines:2,algorithms:2}));
}
// Predicate/register boundaries for the private mixed-integer experiment.
for(const program of [
 `fun N sample\n A = array shape 3 fill 0\n P = 9007199254740990\n for I in 0 to 2\n  P += 1\n  if P greater 9007199254740991\n   A I = 7\n  else\n   A I = 3\n  end\n end\n return (A sum) + P\nend\nActual = 1 sample`,
 `A = array shape 3 fill 0\nP = 9007199254740992\nfor P less 9007199254740995\n A (P - 9007199254740992) = 7\n P += 1\nend\nActual = A sum`,
 `S = 0\nfor I in 9007199254740991 to 9007199254740993\n S += I\nend\nActual = S`,
 `A = array shape 2 fill 0\nP = 9007199254740992\nfor J in 0 to 1\n A J = P\nend\nActual = A sum`,
]) {
 const answers=[];
 for(const compilation of [true,false]){const r=new Interpreter(()=>{},{compilation});try{r.execute(program);answers.push(r.variables.get('Actual'))}finally{r.dispose()}}
 assert.deepEqual(answers[0],answers[1],program);
}
console.log(JSON.stringify({mixedBoundaryPrograms:4}));
