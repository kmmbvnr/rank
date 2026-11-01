// Supplemental shared-process control; pass baseline and candidate checkout paths.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const roots={baseline:process.argv[2],candidate:process.argv[3]},run={};
const source=`A = InputA
B = InputB
Count = 12
for Count greater 0
 A = (A mod 97) + (B mod 89)
 Count -= 1
end
A`;
const a=Int32Array.from({length:64},(_,i)=>i*17%201-100);
const b=Int32Array.from({length:64},(_,i)=>i*13%97-48);
const mod=(a,b)=>(a%b+b)%b;
let expected=Array.from({length:4096},(_,i)=>mod(BigInt(a[Math.floor(i/64)]),97n)+mod(BigInt(b[i%64]),89n));
for(let pass=1;pass<12;pass++)expected=expected.map((x,i)=>mod(x,97n)+mod(BigInt(b[i%64]),89n));
const check=x=>assert.deepEqual([...x],expected), runtimes=[];
for(const [name,root]of Object.entries(roots)){
 const {Interpreter,parse}=await import(pathToFileURL(root+'/packages/interpreter/out/index.js'));
 const {typedArray}=await import(pathToFileURL(root+'/packages/interpreter/out/array-storage.js'));
 const runtime=new Interpreter(()=>{}), program=parse(source);runtimes.push(runtime);
 runtime.variables.set('InputA',typedArray(a,[64,1]));runtime.variables.set('InputB',typedArray(b,[1,64]));
 run[name]=()=>runtime.executeProgram(program).items;check(run[name]());
}
// Alternate warmup too, instead of leaving the first version cold.
for(let pass=0;pass<8;pass++)for(const name of pass%2?['candidate','baseline']:['baseline','candidate']){
 const start=performance.now();while(performance.now()-start<250)run[name]();
}
const rows=[];
for(let pair=0;pair<11;pair++)for(const name of pair%2?['candidate','baseline']:['baseline','candidate']){
 const cpu=process.cpuUsage(),start=performance.now();let count=0,result;
 do{result=run[name]();count++;}while(performance.now()-start<250);
 const elapsed=performance.now()-start,used=process.cpuUsage(cpu);check(result);
 rows.push({pair,name,count,ms:elapsed/count,cpuMs:(used.user+used.system)/1000/count});
}
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
console.log(JSON.stringify({roots,source,note:'Within-process alternating broadcast control; supplemental to fresh-process comparisons; complete array output, independent BigInt oracle; shared process/heap.',rows,summary:Object.keys(run).map(name=>({name,ms:median(rows.filter(r=>r.name===name).map(r=>r.ms)),cpuMs:median(rows.filter(r=>r.name===name).map(r=>r.cpuMs))}))}));
runtimes.forEach(r=>r.dispose());
