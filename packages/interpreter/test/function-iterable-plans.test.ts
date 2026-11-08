import {describe,expect,it} from 'vitest';
import {Interpreter,RankError,formatValue} from '../src/index.js';
import {withDemandBudget,withInterrupt,DemandBudgetExhausted,InterruptedError} from '../src/interrupt.js';
import {native} from '../src/modules/shared.js';
function run(source:string,compilation:boolean) {
    let calls=0;
    const output:string[]=[];
    const runtime=new Interpreter(line=>output.push(line),{compilation,onScalarFunctionExecuted:()=>calls++});
    try { return {value:formatValue(runtime.execute(source)!),output,calls}; }
    catch(error) {return {error:error instanceof RankError?error.format():String(error),output,calls};}
    finally {runtime.dispose();}
}
function compare(source:string,compiled=true) {
    const reference=run(source,false),result=run(source,true);
    expect({...result,calls:0}).toEqual({...reference,calls:0});
    if(compiled)expect(result.calls).toBeGreaterThan(0);
    return result;
}
const prefix='use numbers\nuse sequences\n';
const consume=` Result = 0
 for X in Items
  Result += X
 end
 return Result
end`;
describe('finite iterable plans in compiled functions',()=>{
    it.each(['factors','divisors'])('consumes named %s and unique stages repeatedly',operation=>{
        const source=`${prefix}fun N total
 Source' = N ${operation}
 Items' = Source unique
 Result = 0
 for X in Items
  Result += X
 end
 for X in Items
  Result += X
 end
 return Result
end`;
        for(const n of [1,2,12,360,1000003])compare(`${source}\n${n} total`);
    });
    it('supports branch-local recipes and fresh bindings on each outer iteration',()=>{
        expect(compare(`${prefix}fun N total
 Result = 0
 for I in 1 to N
  if I greater 1
   Items' = I factors unique
   for P in Items
    Result += P
   end
  end
 end
 return Result
end
5 total`).value).toBe('12');
    });
    it('does no work for unused recipes, including failing operands',()=>{
        expect(compare(`${prefix}fun N total
 if N greater 0
  Bad' = (N // 0) factors unique
 end
 return 7
end
1 total`).value).toBe('7');
    });
    it('keeps errors at the consumer after preceding effects',()=>{
        const result=compare(`${prefix}use io
fun N total
 Items' = (N // 0) factors unique
 "before" print
${consume}
1 total`,false);
        expect(result.output).toEqual(['before']);
        expect(result.error).toContain('division by zero');
    });
    it('compiles a failing consumer without moving its error to binding',()=>{
        const result=compare(`${prefix}fun N total
 Items' = (N // 0) factors unique
${consume}
1 total`);
        expect(result.error).toContain('division by zero');
    });
    it.each(['0', '-1'])('keeps native domain errors at the recipe for %s',n=>{
        compare(`${prefix}fun N total
 Items' = N factors unique
${consume}
(${n}) total`);
    });
    it('does not leak a branch-local recipe into another branch',()=>{
        compare(`${prefix}fun N total
 if N greater 0
  Items' = N factors unique
 else
  return Items len
 end
 return 1
end
0 total`,false);
    });
    it('retains captured input bindings through fallback',()=>{
        expect(compare(`${prefix}fun N total
 Items' = N factors unique
 N = 10
${consume}
12 total`,false).value).toBe('5');
    });
    it('retains named recipe rebinding through fallback',()=>{
        compare(`${prefix}fun N total
 Items' = N factors unique
 Items' = 10 factors unique
${consume}
12 total`,false);
    });
    it('retains budgets and cancellation after a cached fast call',()=>{
        const runtime=new Interpreter();
        try{
            runtime.execute(`${prefix}fun N total
 Items' = N factors unique
${consume}`);
            expect(runtime.execute('12 total')).toBe(5n);
            expect(withDemandBudget(10000,()=>runtime.execute('12 total'))).toBe(5n);
            expect(()=>withDemandBudget(1,()=>runtime.execute('12 total'))).toThrow(DemandBudgetExhausted);
            const signal=new Int32Array(new SharedArrayBuffer(4));
            Atomics.store(signal,0,1);
            expect(()=>withInterrupt(signal,()=>runtime.execute('12 total'))).toThrow(InterruptedError);
            expect(runtime.execute('12 total')).toBe(5n);
        }finally{runtime.dispose();}
    });
    it.each(['factors','divisors'])('materializes %s inside a compiled helper',operation=>{
        for(const n of [1,2,12,360,1000003]) compare(`${prefix}fun N total
 Items = N ${operation} array
 N = 1
 Total = Items sum
 Count = Items len
 return Total + Count
end
${n} total`);
    });
    it('owns explicitly completed iterable arrays across writes and calls',()=>{
        expect(compare(`${prefix}fun N values
 Items = N factors unique array
 Alias = Items
 Items 0 = 99
 return Alias sum
end
360 values`).value).toBe('10');
        compare(`${prefix}fun N values
 Items = N factors array
 return Items
end
12 values`);
    });
    it.each(['0','-1'])('keeps explicit factor materialization errors for %s',n=>{
        const result=compare(`${prefix}use io
fun N total
 "before" print
 Items = N factors array
 return Items len
end
(${n}) total`,false);
        expect(result.output).toEqual(['before']);
        expect(result.error).toContain('factors expects a positive integer');
    });
    it('guards native identities after a cached compilation',()=>{
        let calls=0;
        const runtime=new Interpreter(undefined,{onScalarFunctionExecuted:()=>calls++});
        try{
            runtime.execute(`${prefix}fun N total
 Items' = N factors unique
${consume}`);
            expect(runtime.execute('12 total')).toBe(5n);
            expect(calls).toBe(1);
            runtime.variables.set('factors',native('replacement',1,()=>({kind:'array',shape:[1],items:[17n]})));
            expect(runtime.execute('12 total')).toBe(17n);
        }finally{runtime.dispose();}
    });
});

it('links a returned scalar recipe to an ordinary consumer', () => {
    expect(compare(`${prefix}fun N delayed
 Value' = N + 1
 return Value
end
Result = 0
for Once in 1 to 1
 Result = 4 delayed
end
Result`).value).toBe('5');
});
it('retains returned scalar recipe errors at their demand location', () => {
    expect(compare(`${prefix}fun N delayed
 Value' = N // 0
 return Value
end
Result = 0
for Once in 1 to 1
 Result = 0 delayed
end
Result`).error).toContain('division by zero');
});
it.each(["Unused' = 0 delayed", 'for Once in 1 to 1\n 0 delayed\nend'])('preserves explicit-plan laziness and statement demand: %s', consumer => {
    const result = compare(`${prefix}fun N delayed
 Value' = N // 0
 return Value
end
${consumer}
7`, false);
    if (consumer.startsWith('for')) expect(result.error).toContain('division by zero');
    else expect(result.value).toBe('7');
});
