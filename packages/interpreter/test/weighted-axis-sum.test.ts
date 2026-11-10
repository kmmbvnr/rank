import { native } from '../src/modules/shared.js';
import { describe, it, expect } from 'vitest';
import { Interpreter, RuntimeDiagnostics, isRankArray, type RankValue } from '../src/index.js';
import { typedArray, derivedArray, ownedArray, integer32Cells, readArrayItem, writeArrayCell } from '../src/array-storage.js';
import { permutedArray } from '../src/array-permutation.js';
import { weightedAxisSum } from '../src/jit/weighted-axis-sum.js';
import { withInterrupt, withDemandBudget, InterruptedError } from '../src/interrupt.js';
const values = Int32Array.from({ length: 4096 }, (_, i) => (i * 31 % 127) - 63);
const coefficients = [9007199254740993n, -9007199254740991n, 4294967295n, -4294967297n];
const oracle = (weights: bigint[]) => Array.from({ length: 1024 }, (_, i) => weights.reduce((sum, x, k) => sum + x * BigInt(values[i * 4 + k]), 0n));
const cells = (value: RankValue | undefined) => {
    if (!value || !isRankArray(value)) throw Error('expected vector');
    return Array.from({ length: value.shape[0] }, (_, i) => readArrayItem(value, i));
};
describe('weighted integer axis sums', () => {
    it.each([0, 1])('preserves signed words and transposed strides, axis %s', axis => {
        const source = typedArray(values, [1024, 4]);
        const matrix = axis === 0 ? permutedArray(source, [1, 0]) : source;
        const weights = typedArray(BigInt64Array.from(coefficients), axis === 0 ? [4, 1] : [1, 4]);
        expect(cells(weightedAxisSum(matrix, weights, axis))).toEqual(oracle(coefficients));
        expect(cells(weightedAxisSum(weights, matrix, axis))).toEqual(oracle(coefficients));
    });
    it('contracts a physically transposed matrix and rejects wide count words', () => {
        const transposed = Int32Array.from({ length: values.length }, (_, i) => values[i % 1024 * 4 + Math.floor(i / 1024)]);
        const weights = typedArray(BigInt64Array.from(coefficients), [4, 1]);
        expect(cells(weightedAxisSum(typedArray(transposed, [4, 1024]), weights, 0))).toEqual(oracle(coefficients));
        expect(weightedAxisSum(typedArray(new BigInt64Array(4096).fill(4294967297n), [4, 1024]), weights, 0)).toBeUndefined();
    });
    it('accepts small counts in wide storage', () => {
        expect(cells(weightedAxisSum(typedArray(BigInt64Array.from(values, BigInt), [1024, 4]),
            typedArray(BigInt64Array.from(coefficients), [1, 4]), 1))).toEqual(oracle(coefficients));
    });
    it('keeps bounded sums compact and validates zero-matrix coefficients', () => {
        const weights = typedArray(new Int32Array([1, -1, 1, -1]), [1, 4]);
        const result = weightedAxisSum(typedArray(values, [1024, 4]), weights, 1);
        if (!result || !isRankArray(result)) throw Error('expected vector');
        expect(integer32Cells(result)).toBeDefined();
        expect(cells(result)).toEqual(oracle([1n, -1n, 1n, -1n]));
        expect(cells(weightedAxisSum(typedArray(new Int32Array(4096), [1024, 4]), weights, 1))).toEqual(Array(1024).fill(0n));
    });
    it('handles compact weights and low-word carries', () => {
        const weights = [-2147483648n, 2147483647n, -1n, 0n];
        expect(cells(weightedAxisSum(typedArray(values, [1024, 4]), typedArray(Int32Array.from(weights, Number), [1, 4]), 1))).toEqual(oracle(weights));
    });
    it('declines unsafe bounds, opaque readers, reals and incompatible shapes', () => {
        const matrix = typedArray(values, [1024, 4]);
        for (const weights of [typedArray(new BigInt64Array(4).fill(2n ** 62n), [1, 4]),
            typedArray(new Float64Array(4).fill(1), [1, 4]), derivedArray([1, 4], [], i => coefficients[i]),
            typedArray(new Int32Array(8), [2, 4])]) expect(weightedAxisSum(matrix, weights, 1)).toBeUndefined();
        expect(weightedAxisSum(typedArray(new Int32Array(4096).fill(1048577), [1024, 4]), typedArray(new BigInt64Array(4).fill(1n << 40n), [1, 4]), 1)).toBeUndefined();
    });
    it('retains cancellation and declines budgeted execution', () => {
        const matrix = typedArray(values, [1024, 4]), weights = typedArray(BigInt64Array.from(coefficients), [1, 4]);
        expect(() => withInterrupt(new Int32Array([1]), () => weightedAxisSum(matrix, weights, 1))).toThrow(InterruptedError);
        expect(withDemandBudget(1, () => weightedAxisSum(matrix, weights, 1))).toBeUndefined();
    });
    it.each([false, true])('evaluates operands once when the sum binding changes, compilation=%s', compilation => {
        const r = new Interpreter(() => {}, { compilation });
        let calls = 0;
        try {
            r.variables.set('Power', typedArray(BigInt64Array.from(coefficients), [1, 4]));
            r.variables.set('Fetch', native('Fetch', 1, () => {
                calls++;
                r.variables.set('sum', native('customSum', 1, () => 17n));
                return typedArray(values, [1024, 4]);
            }));
            expect(cells(r.execute('((0 Fetch) * Power) sum axis 1'))).toEqual(Array(1024).fill(17n));
            expect(calls).toBe(1);
        } finally { r.dispose(); }
    });
    it.each([false, true])('executes original syntax, compilation=%s', compilation => {
        const r = new Interpreter(() => {}, { compilation });
        try {
            r.variables.set('Counts', typedArray(values, [1024, 4]));
            r.variables.set('Power', typedArray(BigInt64Array.from(coefficients), [4, 1]));
            expect(cells(r.execute('use sequences\n(Counts transpose * Power) sum axis 0'))).toEqual(oracle(coefficients));
            const wide = Array(4).fill(2n ** 62n);
            r.variables.set('Power', typedArray(BigInt64Array.from(wide), [4, 1]));
            expect(cells(r.execute('use sequences\n(Counts transpose * Power) sum axis 0'))).toEqual(oracle(wide));
        } finally { r.dispose(); }
    });
});


describe('exact wide elementwise axis products',()=>{
    const shape=[64,32];
    const left=Array.from({length:2048},(_,i)=>(1n<<90n)+BigInt(i%7-3));
    const right=Array.from({length:2048},(_,i)=>BigInt(i%11-5));
    const expected=(axis:number)=>Array.from({length:shape[1-axis]},(_,frame)=>{
        let total=0n;for(let k=0;k<shape[axis];k++){const i=axis===1?frame*shape[1]+k:k*shape[1]+frame;total+=left[i]*right[i];}return total;
    });
    it.each([0,1,-1,-2])('contracts arbitrary-precision products directly along axis %s',axis=>{
        const a=ownedArray(left,shape),b=typedArray(BigInt64Array.from(right),shape);
        expect(cells(weightedAxisSum(a,b,axis))).toEqual(expected((axis+2)%2));
        expect(cells(weightedAxisSum(b,a,axis))).toEqual(expected((axis+2)%2));
    });
    it('contracts pure transposed and gathered wide inputs',()=>{
        const runtime=new Interpreter(()=>{});
        try{runtime.variables.set('A',ownedArray(left,shape));runtime.variables.set('B',typedArray(BigInt64Array.from(right),shape));
            runtime.execute('use sequences\nAt = A transpose\nBt = B transpose');
            expect(cells(runtime.execute('At * Bt sum axis 0'))).toEqual(expected(1));
            const a=ownedArray(left,shape),b=typedArray(BigInt64Array.from(right),shape);
            expect(cells(weightedAxisSum(permutedArray(a,[1,0]),permutedArray(b,[1,0]),0))).toEqual(expected(1));
            runtime.execute('Rows = 63 to 0 by -1 copy');
            const actual=cells(runtime.execute('A Rows * B sum axis 1'));
            const wanted=Array.from({length:64},(_,row)=>right.slice(row*32,row*32+32).reduce((total,value,k)=>total+value*left[(63-row)*32+k],0n));
            expect(actual).toEqual(wanted);
        }finally{runtime.dispose();}
    });
    it('retains compact exact cancellation after products wider than int64',()=>{
        const a=ownedArray(Array.from({length:2048},(_,i)=>i%2?-(1n<<100n):1n<<100n),shape);
        const b=typedArray(new Int32Array(2048).fill(1),shape);
        const result=weightedAxisSum(a,b,1);
        expect(cells(result)).toEqual(Array(64).fill(0n));
        expect(integer32Cells(result as ReturnType<typeof ownedArray>)).toBeDefined();
    });
    it('declines opaque inputs, reals, shape mismatches and shared memory',()=>{
        const a=ownedArray(left,shape);
        for(const b of [derivedArray(shape,[],i=>right[i]),typedArray(new Float64Array(2048).fill(1),shape),typedArray(new Int32Array(2048),[32,64])]) expect(weightedAxisSum(a,b,1)).toBeUndefined();
        const shared=new BigInt64Array(new SharedArrayBuffer(2048*8));
        expect(weightedAxisSum(a,typedArray(shared,shape),1)).toBeUndefined();
    });
    it.each([false,true])('matches source syntax with compilation=%s',compilation=>{
        const runtime=new Interpreter(()=>{}, {compilation});
        try{runtime.variables.set('A',ownedArray(left,shape));runtime.variables.set('B',typedArray(BigInt64Array.from(right),shape));
            expect(cells(runtime.execute('A * B sum axis 1'))).toEqual(expected(1));
            expect(cells(runtime.execute('A * B sum axis 0'))).toEqual(expected(0));
        }finally{runtime.dispose();}
    });
    it('retains cancellation and budget fallback for wide products',()=>{
        const a=ownedArray(left,shape),b=typedArray(BigInt64Array.from(right),shape);
        expect(()=>withInterrupt(new Int32Array([1]),()=>weightedAxisSum(a,b,1))).toThrow(InterruptedError);
        expect(withDemandBudget(1,()=>weightedAxisSum(a,b,1))).toBeUndefined();
    });
});

    it.each([0, 1])('contracts large Int32 counts when the full sum bound is safe, axis %s', axis => {
        const data = Int32Array.from({ length: 4096 }, (_, i) => (i % 2 ? -1 : 1) * (536870912 + i));
        const source = typedArray(data, [1024, 4]);
        const matrix = axis === 0 ? permutedArray(source, [1, 0]) : source;
        const weights = typedArray(Int32Array.of(10, -11, 12, -13), axis === 0 ? [4, 1] : [4]);
        const result = weightedAxisSum(matrix, weights, axis);
        expect(result).toBeDefined();
        const expected = Array.from({ length: 1024 }, (_, row) => [10n, -11n, 12n, -13n].reduce((sum, value, k) => sum + value * BigInt(data[row * 4 + k]), 0n));
        expect(cells(result)).toEqual(expected);
    });
    it('contracts the ordinary vector spelling on either operand side', () => {
        const matrix = typedArray(values, [1024, 4]);
        const weights = typedArray(Int32Array.of(1, -1, 1, -1));
        for (const [left, right] of [[matrix, weights], [weights, matrix]]) {
            expect(cells(weightedAxisSum(left, right, -1))).toEqual(oracle([1n, -1n, 1n, -1n]));
        }
        expect(weightedAxisSum(matrix, typedArray(Int32Array.of(1, 2, 3)), 1)).toBeUndefined();
        expect(weightedAxisSum(weights, weights, 0)).toBeUndefined();
    });

it('reuses matrix bounds and invalidates them after a tracked cell write', () => {
    const matrix = typedArray(new Int32Array(4096).fill(1), [1024, 4]);
    const weights = typedArray(Int32Array.of(1, 2, 3, 4));
    const d = new RuntimeDiagnostics();
    expect(cells(d.run(() => weightedAxisSum(matrix, weights, 1)))[0]).toBe(10n);
    expect(cells(d.run(() => weightedAxisSum(matrix, weights, 1)))[0]).toBe(10n);
    expect(d.tensorRangeScans).toBe(1);
    writeArrayCell(matrix, 0, 1073741824n);
    expect(cells(d.run(() => weightedAxisSum(matrix, weights, 1)))[0]).toBe(1073741833n);
    expect(d.tensorRangeScans).toBe(2);
});

it('declines opaque typed matrix readers without reading them', () => {
    const matrix = typedArray(new Int32Array(4096).fill(536870912), [1024, 4]);
    let reads = 0;
    Object.defineProperty(matrix, 'itemAt', { value: () => { reads++; return 1n; } });
    expect(weightedAxisSum(matrix, typedArray(Int32Array.of(1, 2, 3, 4)), 1)).toBeUndefined();
    expect(reads).toBe(0);
});
