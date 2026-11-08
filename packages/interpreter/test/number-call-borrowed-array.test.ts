import {describe,expect,it} from 'vitest';
import {Interpreter,RuntimeDiagnostics,RankError,formatValue,type InterpreterOptions} from '../src/index.js';
import {withDemandBudget,withInterrupt} from '../src/interrupt.js';
const reader=`fun A fetch I
  return A I
end\n`;
function run(source:string,options:InterpreterOptions={}) {
 const diagnostics=new RuntimeDiagnostics(),sources:string[]=[];
 const runtime=new Interpreter(()=>{},{...options,onIntegerLoopCompiled:s=>sources.push(s)});
 try {const v=diagnostics.run(()=>runtime.execute(source));return {value:v===undefined?undefined:formatValue(v),diagnostics,sources};}
 finally {runtime.dispose();}
}
function compare(source:string) {
 const result=run(source);
 expect(result.value).toBe(run(source,{compilation:false}).value);
 expect(result.value).toBe(run(source,{numberLoopCompilation:false}).value);
 return result;
}
const body=`fun N build
  A = array shape 3 fill 0
  Total = 0
  for I in 0 till N
    A 0 += I
    Total += A fetch 0
  end
  return Total
end\n5 build`;
const raw=(sources:string[])=>sources.some(s=>/const call0 = calls\[0\];/.test(s)
 && /call0\(cells\d+,/.test(s));

describe('read-only array calls in private Number regions',()=>{
 it('reads private stores without publishing or copying the buffer',()=>{
  const r=compare(reader+body);expect(r.value).toBe('20');
  expect(r.diagnostics.numberLoops).toBe(1);expect(r.diagnostics.numberFunctions).toBe(5);
  expect(r.diagnostics.typedArrayPublications).toBe(1);expect(r.diagnostics.cowCopies).toBe(0);
  expect(r.diagnostics.numberLoopReadBuffers).toBe(0);expect(raw(r.sources)).toBe(true);
 });
 it('uses the current buffer after private Int32 widening',()=>{
  const r=compare(reader+body.replace('A 0 += I','A 0 += 2147483647'));
  expect(r.value).toBe('32212254705');expect(r.diagnostics.numberFunctions).toBe(5);expect(r.diagnostics.numberLoopOverflows).toBe(0);
 });
 it('rolls back the caller before exact replay on helper overflow',()=>{
  const r=compare(`fun A twice I
  return A I * 2
end
A = array shape 1 fill 0
Total = 0
for I in 1 to 3
  A 0 += 3002399751580331
  Total += A twice 0
end
Total + A 0`);
  expect(r.value).toBe('45035996273704965');expect(r.diagnostics.numberLoopOverflows).toBeGreaterThan(0);
 });
 it('reads stored arrays and observes later mutations',()=>{
  const r=compare(reader+`use sequences
A = array 2 3 5
Total = 0
for I in 0 till A len
  Total += A fetch I
end
A 1 = 7
for I in 0 till A len
  Total += A fetch I
end
Total`);
  expect(r.value).toBe('24');expect(r.diagnostics.numberFunctions).toBe(6);
 });
 it('keeps wide integer loads exact',()=>{
  const r=compare(reader+`A = array shape 2 fill 9007199254740993
Total = 0
for I in 0 till 2
  Total += A fetch I
end
Total`);expect(r.value).toBe('18014398509481986');
 });
 it.each(['-1','3'])('retains invalid read %s through exact replay',index=>{
  for(const compilation of [true,false]){
   const runtime=new Interpreter(()=>{},{compilation}),d=new RuntimeDiagnostics();
   try {let error:unknown;try {d.run(()=>runtime.execute(reader+body.replace('A fetch 0',`A fetch ${index}`)));}catch(e){error=e;}
    expect(error).toBeInstanceOf(RankError);expect((error as RankError).message).toContain('array index out of bounds');
    if(compilation)expect(d.numberLoopOverflows).toBeGreaterThan(0);
   } finally {runtime.dispose();}
  }
 });
 it('preserves unused unsafe cells when caller preparation declines Number',()=>{
  const r=compare(reader+`A = array shape 2 fill 9007199254740993
A 0 = 7
Total = 0
for I in 0 till 1
  Total += A I
  Total += A fetch I
end
Total`);
  expect(r.value).toBe('14');
  expect(r.diagnostics.numberLoopReadBuffers).toBe(0);
 });
 it('declines mutating callees',()=>{
  const r=compare(`fun A alter N
  A 0 += N
  return A 0
end
A = array shape 1 fill 0
Total = 0
for I in 1 to 3
  Total += A alter I
end
Total + A 0`);expect(r.value).toBe('6');expect(raw(r.sources)).toBe(false);
 });
 it('declines array callees without a raw Number implementation',()=>{
  const r=compare(`fun N double
  return N * 2
end
fun A fetch I
  return (A I) double
end
A = array shape 3 fill 7
Total = 0
for I in 0 till 3
  Total += A fetch I
end
Total`);expect(r.value).toBe('42');
 });
 it('preserves ordinary alias snapshots',()=>{
  const r=compare(reader+`A = array shape 1 fill 1
B = A
Total = 0
for I in 1 to 3
  A 0 += I
  Total += B fetch 0
end
Total + A 0`);expect(r.value).toBe('10');
 });
 it('does not hide preceding stores from captured reads',()=>{
  const r=compare(`A = array shape 1 fill 0
fun B fetch I
  return B I + A I
end
Total = 0
for I in 1 to 3
  A 0 = I
  Total += A fetch 0
end
Total`);expect(r.value).toBe('12');
 });
 it.each(['array shape 2 fill 1.5','array shape 2 fill true'])('retains unsupported %s arguments',array=>{
  const r=compare(reader+`A = ${array}
Last = A fetch 0
for I in 0 till 2
  Last = A fetch I
end
Last`);expect(raw(r.sources)).toBe(false);
 });
 it('rechecks callee identity on caller reentry',()=>{
  const r=compare(reader+'lookup = fetch\n'+body.replace(/fetch/g,'lookup').replace('5 build',`First = 5 build
fun A replacement I
  return 7
end
lookup = replacement
Second = 5 build
First + Second`));expect(r.value).toBe('55');
 });
 it('publishes preceding stores on errors and retains array call frames',()=>{
  const runtime=new Interpreter(()=>{});
  try {let error:unknown;
   try {runtime.execute(`fun A fail I
  return A I // 0
end
A = array shape 1 fill 0
for I in 1 to 3
  A 0 = 2147483648
  A fail 0
end`);} catch(e){error=e;}
   expect(error).toBeInstanceOf(RankError);expect((error as RankError).format()).toContain('division by zero');
   expect((error as RankError).format()).toContain('2147483648');expect(runtime.execute('A 0')).toBe(2147483648n);
  } finally {runtime.dispose();}
 });
 it.each(['7','2147483648'])('bounds error diagnostics for %s buffers without copying',fill=>{
  const runtime=new Interpreter(()=>{}),d=new RuntimeDiagnostics();
  try {
   runtime.execute(`fun A fail I
  return A I // 0
end
A = array shape 100000 fill ${fill}`);
   let error:unknown;
   try {d.run(()=>runtime.execute(`Total = 0
for I in 0 till 1
  Total += A I
  Total += A fail I
end`));}catch(e){error=e;}
   expect(error).toBeInstanceOf(RankError);
   expect((error as RankError).format()).toContain(`array[100000]: ${Array(8).fill(fill).join(' ')} …`);
   expect(d.numberFunctions).toBe(1);expect(d.typedArrayPublications).toBe(0);expect(d.numberLoopReadBuffers).toBe(0);
  } finally {runtime.dispose();}
 });
 it('preserves short-circuiting before unused errors',()=>{
  const r=compare(`fun A fail I
  return A I // 0
end
A = array shape 1 fill 3
Count = 0
for I in 1 to 3
  if false and A fail 0 equal 0
    Count += 1
  end
end
Count`);expect(r.value).toBe('0');
 });
 it('reads multiple current buffers without changing argument order',()=>{
  const r=compare(`fun A B mix I
  return A I * 3 + B I
end
fun N build
  A = array shape 2 fill 2
  B = array shape 2 fill 5
  Total = 0
  for I in 0 till 2
    B I = N
    Total += A B mix I
  end
  return Total
end
2147483648 build`);
  expect(r.value).toBe('4294967308');expect(raw(r.sources)).toBe(true);
 });
 it('retains empty array length and boolean results',()=>{
  const r=compare(`use sequences
fun A empty I
  return A len equal I
end
fun N build
  A = array shape N fill 0
  Count = 0
  for I in 0 till 3
    if A empty I
      Count += 1
    end
  end
  return Count
end
0 build`);
  expect(r.value).toBe('1');
 });
 it('declines multidimensional buffer arguments',()=>{
  const r=compare(`fun A diagonal I
  return A I I
end
A = array shape 2 2 fill 3
Total = 0
for I in 0 till 2
  Total += A diagonal I
end
Total`);
  expect(r.value).toBe('6');expect(raw(r.sources)).toBe(false);
 });
 it('retains observable polling and demand-budget execution',()=>{
  const runtime=new Interpreter(()=>{}),d=new RuntimeDiagnostics();
  try {runtime.execute(reader+body.slice(0,body.lastIndexOf('5 build')));
   const signal={length:1,load:()=>0,store(){},exchange:()=>0,wait(){}};
   expect(d.run(()=>withInterrupt(signal,()=>runtime.execute('5 build')))).toBe(20n);
   expect(d.run(()=>withDemandBudget(10000,()=>runtime.execute('5 build')))).toBe(20n);
  } finally {runtime.dispose();}
 });
});

it('keeps completed private buffers borrowed across nested exact helpers', () => {
 const result = compare(`use sequences
fun Values prefix
 Picked = Values take 1
 return Picked sum
end
fun Values relay
 return Values prefix
end
Input = array shape 5000 fill 7
Total = 0
for I in 1 to 20
 Total += Input relay
end
Total`);
 expect(result.value).toBe('140');
 expect(result.diagnostics.numberLoops).toBeGreaterThan(0);
 expect(result.diagnostics.numberFunctionArrayBorrows).toBeGreaterThan(0);
 expect(result.diagnostics.cellsComputed).toBeLessThan(5000);
});
