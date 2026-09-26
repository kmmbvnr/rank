import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';
import { run } from './support.js';

function counted(source: string, options: ConstructorParameters<typeof Interpreter>[1]) {
    let loops = 0, calls = 0;
    const runtime = new Interpreter(undefined, { ...options,
        onIntegerLoopExecuted: () => loops++, onScalarFunctionExecuted: () => calls++ });
    try {
        return { value: formatValue(runtime.execute(source)!), loops, calls };
    } catch (error) {
        return { error: error instanceof RankError ? error.message : String(error), loops, calls };
    } finally { runtime.dispose(); }
}

describe('and and or after a single boolean', () => {
    it('skip the right side when the left decides', () => {
        const guard = 'Password = array "a" "b"\nPosition = 8\n';
        expect(run(guard + 'Position less 2 and Password Position equal ""')).toBe('false');
        expect(run(guard + 'Position at least 2 or Password Position equal ""')).toBe('true');
        expect(run(guard + 'Position = 1\nPosition less 2 and Password Position equal "b"')).toBe('true');
        expect(() => run(guard + 'Position greater 2 and Password Position equal ""')).toThrow('out of bounds');
        expect(run('false and 1')).toBe('false');
        expect(run('true or Missing')).toBe('true');
    });

    it('skip effects on the right side, including suspended calls', () => {
        expect(run(`use algo
fun visit Log V
 Log push V
 return V
end
Log = queue
A = (Log false visit) and (Log true visit)
B = (Log true visit) or (Log false visit)
C = (Log true visit) and (Log false visit)
Log`)).toBe('false true true false');
    });

    it('guard statement conditions and nested chains', () => {
        expect(run(`A = array 1 2 3
I = 5
if I less 3 and A I greater 1 or I equal 5
 R = "yes"
else
 R = "no"
end
R`)).toBe('yes');
    });

    it('keep arrays on the left elementwise and reject a mask after a flag', () => {
        expect(run('A = array true false\nA and true')).toBe('true false');
        expect(run('A = array true false\nA or false')).toBe('true false');
        expect(run('(array true false) and (array true true)')).toBe('true false');
        expect(() => run('true and (array true false)')).toThrow('Write `Mask and Flag`');
        expect(run('false and (array true false)')).toBe('false');
        expect(() => run('true and 1')).toThrow();
    });

    it('leave xor and compound assignment eager', () => {
        expect(() => run('A = array 1\nfalse xor A 5 equal 1')).toThrow('out of bounds');
        expect(() => run('A = array 1\nF = false\nF and= A 5 equal 1\nF')).toThrow('out of bounds');
    });

    it('guard inside compiled integer loops', () => {
        const source = `Password = array "a" "" "b"
Count = 0
for I in 0 until 10
 if I less 3 and Password I equal ""
  Count += 1
 end
 if I at least 3 or Password I equal "a"
  Count += 10
 end
end
Count`;
        const compiled = counted(source, { integerLoopCompilation: true });
        expect(compiled).toEqual({ value: '81', loops: compiled.loops, calls: 0 });
        expect(compiled.loops).toBeGreaterThan(0);
        expect(counted(source, { integerLoopCompilation: false }).value).toBe('81');
    });

    it('guard inside compiled scalar functions', () => {
        const source = `fun safe X
 return X equal 0 or 10 // X equal 1
end
R = true
for I in 0 to 1
 R = I safe
end
(0 safe) and R`;
        for (const scalarFunctionCompilation of [true, false]) {
            expect(counted(source, { scalarFunctionCompilation, integerLoopCompilation: false }).value).toBe('false');
        }
        expect(counted(source, { scalarFunctionCompilation: true, integerLoopCompilation: false }).calls)
            .toBeGreaterThan(0);
    });
});
