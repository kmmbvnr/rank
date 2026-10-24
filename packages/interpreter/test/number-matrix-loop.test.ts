import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';
import { parse } from '../src/parser.js';
import { withInterrupt } from '../src/interrupt.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

function execute(source: string, options: InterpreterOptions = {}) {
    const diagnostics = new RuntimeDiagnostics();
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false, ...options });
    let error: string | undefined;
    try {
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error, variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(source: string, negativeRead = false) {
    const candidate = execute(source);
    const reference = execute(source, { compilation: false });
    // Existing compiled readers omit the negative coordinate from their message.
    if (negativeRead) reference.observation.error = reference.observation.error?.replace(/(axis \d+): -1/, '$1');
    expect(candidate.observation).toEqual(reference.observation);
    expect(candidate.observation).toEqual(execute(source, { numberLoopCompilation: false }).observation);
    return candidate;
}

describe('private Number registers over multidimensional arrays', () => {
    it.each([
        ['integer', '0', 'I * 12 + J * 4 + K', '+= 1'],
        ['real', '0.0', '(I * 12 + J * 4 + K) / 2', '*= 1.5'],
        ['boolean', 'false', 'I + J + K greater 2', 'or= true'],
    ])('reads and writes %s cubes with independent aliased buffers', (_, fill, value, update) => {
        const result = compare(`A = array shape 2 3 4 fill ${fill}
B = A
for I in 0 till 2
 for J in 0 till 3
  for K in 0 till 4
   A I J K = ${value}
   B I J K ${update}
   Read = A I J K
  end
 end
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });

    it('refreshes cached dimensions on every loop entry', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        const loop = parse(`for I in 0 till Size
 for J in 0 to Size
  A I J = (I + J) / 2
  Read = A I J
 end
end`);
        try {
            for (let size = 1; size <= 3; size++) {
                runtime.execute(`Size = ${size}\nA = array shape Size (Size + 1) fill 0.0\nRead = 0.0`);
                diagnostics.run(() => runtime.executeProgram(loop));
                expect(runtime.variables.get('Read')).toBe((2 * size - 1) / 2);
                runtime.execute(`Last = A (Size - 1) Size`);
                expect(runtime.variables.get('Last')).toBe((2 * size - 1) / 2);
            }
            expect(diagnostics.numberLoops).toBe(3);
        } finally { runtime.dispose(); }
    });

    it('compiles the Gaussian elimination from issue 445', () => {
        const result = compare(`use numbers
use sequences
Nn = 8
A = array shape Nn (Nn + 1) fill 0.0
for I in 0 till Nn
 for J in 0 till Nn
  A I J = 1.0 / (I + J + 1)
 end
 A I I = (A I I) + 1.0
 A I Nn = 1.0
end
for C in 0 till Nn
 Pv = A C C
 for R in (C + 1) till Nn
  F = (A R C) / Pv
  for J in C to Nn
   A R J -= F * (A C J)
  end
 end
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(2);
    });

    it.each([0, 1, 2])('checks axis %s on reads and publishes preceding writes', axis => {
        const indices = ['0', '0', '0']; indices[axis] = 'I';
        const result = compare(`A = array shape 2 3 4 fill 1.0
Alias = A
for I in 0 to 4
 Before = I
 A 0 0 0 += 0.5
 Read = A ${indices.join(' ')}
end`);
        expect(result.observation.error).toContain(`out of bounds on axis ${axis}`);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it.each([0, 1, 2])('checks axis %s on writes before evaluating the RHS', axis => {
        const indices = ['0', '0', '0']; indices[axis] = 'I';
        const size = [2, 3, 4][axis];
        const result = compare(`A = array shape 2 3 4 fill 1.0
Alias = A
for I in 0 to 4
 Before = I
 A ${indices.join(' ')} = 1.0 / (${size} - I)
end`);
        expect(result.observation.error).toContain(`out of bounds on axis ${axis}`);
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it.each([0, 1, 2])('preserves negative-index read and write errors on axis %s', axis => {
        const indices = ['0', '0', '0']; indices[axis] = '(1 - I)';
        for (const access of [`Read = A ${indices.join(' ')}`, `A ${indices.join(' ')} += 1.0`]) {
            const result = compare(`A = array shape 2 3 4 fill 1.0
for I in 0 to 2
 Before = I
 ${access}
end`, access.startsWith('Read'));
            expect(result.observation.error).toContain(`axis ${axis}`);
            expect(result.diagnostics.numberLoops).toBe(1);
        }
    });

    it.each(['0 3', '2 0', '2 0 4'])('handles empty shape %s without accessing cells', shape => {
        const indices = shape.split(' ').map(() => '0').join(' ');
        const result = compare(`A = array shape ${shape} fill 0.0
for I in 0 till 0
 A ${indices} = 1.0
end`);
        expect(result.observation.error).toBeUndefined();
        const read = compare(`A = array shape ${shape} fill 0.0
for I in 0 to 1
 Read = A ${indices}
end`);
        expect(read.observation.error).toContain('out of bounds');
    });

    it('widens Int32 matrix stores and preserves the original snapshot', () => {
        const result = compare(`A = array shape 64 64 fill 2147483647
Alias = A
for I in 0 to 2
 A I I += I + 1
 Read = A I I
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(0);
    });

    it('discards every private matrix store on integer overflow', () => {
        const result = compare(`A = array shape 2 3 fill 9007199254740991
Alias = A
for I in 0 till 2
 A I 0 += 1
end`);
        expect(result.observation.error).toBeUndefined();
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.diagnostics.numberLoopOverflows).toBe(1);
    });

    it('does not flatten an out-of-bounds column into the next row', () => {
        const result = compare(`A = array shape 2 3 fill 1.0
for I in 0 to 1
 A 0 3 = 2.0
end`);
        expect(result.observation.error).toContain('out of bounds on axis 1: 3');
        expect(result.diagnostics.numberLoops).toBe(1);
    });

    it('publishes matrix progress on cancellation and runs finally', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        const flag = new Int32Array(1); flag[0] = 1;
        try {
            expect(() => withInterrupt(flag, () => diagnostics.run(() => runtime.execute(`A = array shape 2 3 fill 0.0
Alias = A
Done = 0
Last = -1
try
 for I in 0 to 1000000
  A (I mod 2) (I mod 3) += 1.0
  Last = I
 end
finally
 Done = 1
end`)))).toThrow('Interrupted');
            runtime.execute('Total = A sum sum\nOriginal = Alias sum sum');
            expect(runtime.variables.get('Total')).toBe(Number(runtime.variables.get('Last')) + 1);
            expect(runtime.variables.get('Original')).toBe(0);
            expect(runtime.variables.get('Done')).toBe(1n);
            expect(diagnostics.numberLoops).toBe(1);
        } finally { runtime.dispose(); }
    });
});
