import { expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { ownedArray, typedArray, readArrayItem } from '../src/array-storage.js';
import { mapStoredIntegers } from '../src/integer-array-kernel.js';
import { withInterrupt, InterruptedError } from '../src/interrupt.js';
import type { RankArray, RankValue } from '../src/value.js';
function gcd(a: bigint, b: bigint): bigint { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a,b] = [b,a%b]; return a; }
function lcm(a: bigint, b: bigint) { if (!a || !b) return 0n; const value = a / gcd(a,b) * b; return value < 0n ? -value : value; }
const cells = (a: RankArray) => Array.from({ length: a.shape.reduce((x,y)=>x*y,1) }, (_, i) => readArrayItem(a,i));
it.each([0n, 1n, -3n, 37n, 9007199254740993n, 1n<<80n])('matches exact scalar LCM with either scalar side at %s', scalar => {
    const input = [0n, -6n, 12n, 9007199254740993n, -(1n<<63n), (1n<<80n)+1n];
    const source = ownedArray(input);
    for (const reverse of [false,true]) {
        const result = mapStoredIntegers(reverse ? scalar : source, reverse ? source : scalar, 'lcm')!;
        expect(cells(result)).toEqual(input.map(x=>lcm(x,scalar)));
    }
    expect(cells(source)).toEqual(input);
});
it('broadcasts matrix operands and publishes an independent result', () => {
    const left = typedArray(new BigInt64Array([6n,9007199254740993n]),[2,1]);
    const right = ownedArray([0n,-10n,37n],[1,3]);
    const result = mapStoredIntegers(left,right,'lcm')!;
    expect(result.shape).toEqual([2,3]);
    const expected = [6n,9007199254740993n].flatMap(a=>[0n,-10n,37n].map(b=>lcm(a,b)));
    expect(cells(result)).toEqual(expected);
    left.items[0]=12n;
    expect(cells(result)).toEqual(expected);
    expect(cells(mapStoredIntegers(left,right,'lcm')!)).toEqual([12n,9007199254740993n].flatMap(a=>[0n,-10n,37n].map(b=>lcm(a,b))));
});
it('declines opaque cells and polls long private work', () => {
    let reads=0;
    const host: RankArray = { kind:'array',shape:[2],get items(): RankValue[]{ reads++;throw Error('opaque'); } };
    expect(mapStoredIntegers(host,2n,'lcm')).toBeUndefined();
    expect(reads).toBe(0);
    const signal = new Int32Array(new SharedArrayBuffer(4));Atomics.store(signal,0,1);
    const input = Array<bigint>(2048).fill(6n), source = ownedArray(input);
    expect(()=>withInterrupt(signal,()=>mapStoredIntegers(source,2n,'lcm'))).toThrow(InterruptedError);
    expect(cells(source)).toEqual(input);
});
it.each([true,false])('integrates ranked LCM without changing unary or shadowed calls (compilation=%s)', compilation=>{
    const runtime = new Interpreter(()=>{}, {compilation});
    try {
        runtime.execute('use numbers\nA = array -6 0 15\nResult = A lcm 10');
        expect(cells(runtime.variables.get('Result') as RankArray)).toEqual([30n,0n,30n]);
        expect(runtime.execute('A lcm')).toBe(0n);
        expect(()=>runtime.execute('Bad = array 2 1.5\nBad lcm 3')).toThrow(/integer/);
        const custom=new Interpreter(()=>{}, {compilation});
        try {
            custom.execute('fun A lcm B = A - B\nA = array -6 0 15\nResult = A lcm 10');
            expect(cells(custom.variables.get('Result') as RankArray)).toEqual([-16n,-10n,5n]);
        } finally {custom.dispose();}
    } finally {runtime.dispose();}
});
