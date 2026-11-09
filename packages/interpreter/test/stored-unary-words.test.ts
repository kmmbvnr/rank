import {expect,it} from 'vitest';
import {Interpreter,isRankArray,type RankArray} from '../src/index.js';
import {typedArray,readArrayItem} from '../src/array-storage.js';
import {mapStoredUnary} from '../src/unary-array-kernel.js';
import {registerScalarView} from '../src/integer-view.js';
import {withDemandBudget,DemandBudgetExhausted,withInterrupt,InterruptedError} from '../src/interrupt.js';

it('matches Number conversion on both words throughout the signed Int64 range',()=>{
    const values=Array.from({length:2048},(_,i)=>BigInt.asIntN(64,(BigInt(i)*0x9e3779b97f4a7c15n)^0x123456789abcdefn));
    const data=typedArray(BigInt64Array.from(values),[32,64]);
    const result=mapStoredUnary(data,'integer',n=>n,'real');
    expect(result?.shape).toEqual([32,64]);
    expect(values.map((_,i)=>readArrayItem(result!,i))).toEqual(values.map(Number));
});

it.each([false,true])('keeps exact roots around perfect squares and unsafe-input replay, compilation=%s',compilation=>{
    const roots=[1n,2n,46341n,67108864n,94906265n];
    const values=Array.from({length:2048},(_,i)=>{const root=roots[Math.floor(i/3)%roots.length];return root*root+BigInt(i%3-1);});
    const wanted=values.map((_,i)=>roots[Math.floor(i/3)%roots.length]-(i%3===0?1n:0n));
    const runtime=new Interpreter(undefined,{compilation});
    try{
        runtime.variables.set('Data',typedArray(BigInt64Array.from(values)));
        runtime.execute('use numbers\nuse sequences');
        const result=runtime.execute('Data isqrt copy');
        if(!result||!isRankArray(result))throw Error('expected roots');
        expect(values.map((_,i)=>readArrayItem(result,i))).toEqual(wanted);
        values[1024]=9007199254740993n;wanted[1024]=94906265n;
        runtime.variables.set('Data',typedArray(BigInt64Array.from(values)));
        const wide=runtime.execute('Data isqrt copy') as RankArray;
        expect(values.map((_,i)=>readArrayItem(wide,i))).toEqual(wanted);
        values[1025]=-1n;
        const source=BigInt64Array.from(values),saved=source.slice();
        runtime.variables.set('Data',typedArray(source));
        expect(()=>runtime.execute('Result = Data isqrt copy')).toThrow(/nonnegative/);
        expect(runtime.variables.has('Result')).toBe(false);expect(source).toEqual(saved);
    }finally{runtime.dispose();}
});

it('reads a trusted reversed strided view without changing its source',()=>{
    const values=BigInt64Array.from({length:4096},(_,i)=>BigInt(i)*4000000007n);
    const data=typedArray(values),saved=values.slice();
    const view=registerScalarView<RankArray>({kind:'array',shape:[2048],items:[]},data,i=>4095-i*2,{linear:()=>({offset:4095,stride:-2})});
    const result=mapStoredUnary(view,'integer',n=>Math.sqrt(n),'real');
    expect(result).toBeDefined();
    for(let i=0;i<2048;i++)expect(readArrayItem(result!,i)).toBe(Math.sqrt(Number(values[4095-i*2])));
    expect(values).toEqual(saved);
});

it('preserves budget and cancellation boundaries for private unary loads',()=>{
    const source=typedArray(new BigInt64Array(4096).fill(1000000000000n));
    const call=()=>mapStoredUnary(source,'integer',Math.sqrt,'integer');
    expect(()=>withDemandBudget(1,call)).toThrow(DemandBudgetExhausted);
    expect(()=>withInterrupt(new Int32Array([1]),call)).toThrow(InterruptedError);
    expect(call()).toBeDefined();
});
