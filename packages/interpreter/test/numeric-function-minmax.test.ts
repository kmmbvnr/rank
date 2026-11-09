import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, type NativeFunction, type RankArray } from '../src/index.js';
import { typedArray, readArrayItem } from '../src/array-storage.js';
function run(operator: string, input: RankArray, bound: bigint | number, compilation = true, reversed = false) {
    const diagnostics = new RuntimeDiagnostics(), r = new Interpreter(() => {}, { compilation, scalarFunctionCompilation: false });
    try {
        r.execute(`use sequences
fun Values clamp Bound
 Grid = Values reshape #
 return ${reversed ? `Bound ${operator} Grid` : `Grid ${operator} Bound`}
end`);
        const fn = r.variables.get('clamp') as NativeFunction;
        const out = diagnostics.run(() => fn.call([input, bound])) as RankArray;
        return { values: Array.from({length:out.shape[0]}, (_, i) => readArrayItem(out, i)), count:diagnostics.compiledArrayFunctions };
    } catch(error) { return { error:(error as Error).message, count:diagnostics.compiledArrayFunctions }; }
    finally { r.dispose(); }
}
describe.each(['min', 'max'])('numeric function %s', operator => {
    it.each([-2147483648n, -3n, 0n, 7n, 2147483647n])('compiles exact integer clamps at %s', bound => {
        const input = () => typedArray(new Int32Array([-2147483648,-9,-1,0,5,2147483647]));
        const actual = run(operator,input(),bound);
        expect(actual.values).toEqual(run(operator,input(),bound,false).values);
        expect(actual.count).toBe(1);
    });
    it.each([1,8,64,257])('keeps real ties and NaN semantics across size %s', length => {
        for (const reversed of [false,true]) for (const bound of [0,-0,NaN,3.5]) {
            const input = () => typedArray(Float64Array.from({length}, (_,i)=>[0,-0,NaN,2.5,-3.5][i%5]));
            const actual = run(operator,input(),bound,true,reversed), expected = run(operator,input(),bound,false,reversed);
            expect(actual.values).toEqual(expected.values);
            for (let i=0;i<length;i++) {
                const left = reversed ? bound : [0,-0,NaN,2.5,-3.5][i%5], right = reversed ? [0,-0,NaN,2.5,-3.5][i%5] : bound;
                expect(Object.is(actual.values?.[i], operator==='min' ? right<left ? right:left : right>left ? right:left)).toBe(true);
            }
        }
    });
    it('retains mixed-kind and wide integer fallback', () => {
        for (const bound of [0n,1n<<80n]) {
            const input = () => bound===0n ? typedArray(new Float64Array([-2.5,0,3.5])) : typedArray(new Int32Array([-1,0,1]));
            const actual = run(operator,input(),bound), expected = run(operator,input(),bound,false);
            expect(actual).toEqual(expected);
            expect(actual.count).toBe(0);
        }
    });
});
it('fuses clipped correlated roots with a sum', () => {
    const r=new Interpreter(()=>{}, {scalarFunctionCompilation:false}), d=new RuntimeDiagnostics();
    try {
        r.execute('use numbers\nfun Values clippedRoots\n Clipped = Values max 0\n Roots = Clipped isqrt\n return Roots sum\nend');
        const fn=r.variables.get('clippedRoots') as NativeFunction;
        expect(d.run(()=>fn.call([typedArray(new Int32Array([-10,-1,0,3,16]))]))).toBe(5n);
        expect(d.compiledArrayFunctions).toBe(1);
    } finally {r.dispose();}
});
