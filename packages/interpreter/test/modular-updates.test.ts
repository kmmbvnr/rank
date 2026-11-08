import { expect, it } from 'vitest';
import { Interpreter, formatValue, RuntimeDiagnostics } from '../src/index.js';

function run(source: string, compilation: boolean) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    try {
        const result = diagnostics.run(() => formatValue(runtime.execute(source)!));
        return { result, diagnostics };
    } finally { runtime.dispose(); }
}
it.each([false, true])('applies trailing mod to the scalar update (%s)', compilation => {
    expect(run('X = 6\nX += 1 mod 7\nX', compilation).result).toBe('0');
    expect(run('X = 6\nX += (1 mod 7)\nX', compilation).result).toBe('7');
    expect(run('X = 6\nX *= 9 mod 7\nX', compilation).result).toBe('5');
});
it.each([false, true])('keeps duplicate scatter semantics (%s)', compilation => {
    const prefix = 'Values = array 6 5\nKeys = array 0 0 1\nWeights = array 2 3 4\n';
    expect(run(prefix + 'Values Keys += Weights mod 7\nValues', compilation).result).toBe('2 2');
    expect(run(prefix + 'Values Keys += Weights mod 7 .accumulate\nValues', compilation).result).toBe('4 2');
    expect(run(prefix + 'Values Keys *= Weights mod 7 .accumulate\nValues', compilation).result).toBe('1 6');
});
it.each([false, true])('reduces enormous integers and negative residues exactly (%s)', compilation => {
    const huge = 10n ** 100n + 123n;
    for (const modulus of [7n, -7n, 1n]) {
        const remainder = (value: bigint) => (value % modulus + modulus) % modulus;
        const expected = remainder(huge * huge * huge);
        expect(run(`Values = array ${huge}\nValues (array 0 0) *= ${huge} mod ${modulus} .accumulate\nValues 0`, compilation).result).toBe(String(expected));
    }
});
it.each(['+=', '-=', '*='])('compiles modular %s with and without accumulation', operator => {
    for (const accumulate of ['', '.accumulate']) {
        const source = `Values = array 2000000000 2000000001\nKeys = array 0 0 1\nWeights = array 2000000001 2000000002 2000000003\nfor I in 1 to 3\n Values Keys ${operator} Weights mod 2147483647 ${accumulate}\n Done = I\nend\nValues`;
        const compiled = run(source, true);
        expect(compiled.result).toBe(run(source, false).result);
        expect(compiled.diagnostics.numberLoops).toBe(1);
    }
});
it.each([false, true])('snapshots RHS and selector aliases (%s)', compilation => {
    expect(run('A = array 1 0 1\nSaved = A\nA A += A mod 2 .accumulate\ntuple A Saved', compilation).result)
        .toBe(run('A = array 1 0 1\nSaved = A\nA (array 1 0 1) += (array 1 0 1) mod 2 .accumulate\ntuple A Saved', false).result);
});
it.each([false, true])('preserves the target on validation failures (%s)', compilation => {
    for (const command of [
        'A (array 0 9) *= 3 mod 7 .accumulate',
        'A (array 0 0) *= (array 3) mod 7 .accumulate',
        'A (array 0 0) *= 3 mod 0 .accumulate',
        'A (array 0 0) *= (array 3 "bad") mod 7 .accumulate',
        'A (array 0 0) *= 3 mod (array 7) .accumulate',
    ]) {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute('A = array 2 3');
            expect(() => runtime.execute(command)).toThrow();
            expect(formatValue(runtime.execute('A')!)).toBe('2 3');
        } finally { runtime.dispose(); }
    }
});
it.each([false, true])('handles scalar, tensor and range selections (%s)', compilation => {
    expect(run('A = array 6 5 4\nA 0 += 3 mod 7\nA (1 to 2) *= 3 mod 7\nA', compilation).result).toBe('2 1 5');
    expect(run('use sequences\nA = array 6 5 4 3 shape 2 2\nA (array 0 0) # += 3 mod 7 .accumulate\nA reshape 4', compilation).result).toBe('5 4 4 3');
});
it.each([false, true])('keeps grouping and ordinary division before mod (%s)', compilation => {
    expect(run('X = 6\nX *= (1 + 2) mod 7\nX', compilation).result).toBe('4');
    expect(run('X = 20\nX //= 3 mod 5\nX', compilation).result).toBe('1');
    expect(run('A = array 20\nA 0 //= 3 mod 5\nA 0', compilation).result).toBe('1');
    expect(run('X = 6\nX += 1 mod 7 * 3\nX', compilation).result).toBe('9');
});
it.each([false, true])('supports whole arrays and scalar functions (%s)', compilation => {
    expect(run('A = array 6 5\nA += 3 mod 7\nA', compilation).result).toBe('2 1');
    expect(run('fun N result\n X = 6\n X += N mod 7\n return X\nend\n3 result', compilation).result).toBe('2');
});
it.each([-7, 2147483649])('replays unsupported compiled modulus %s exactly', modulus => {
    const source = `A = array 6 5\nKeys = array 0 0 1\nfor I in 1 to 3\n A Keys *= 2000000000 mod ${modulus} .accumulate\n Done = I\nend\nA`;
    expect(run(source, true).result).toBe(run(source, false).result);
});
it('compiles modular range selection and a fused RHS', () => {
    for (const accumulate of ['', '.accumulate']) {
        const source = `A = array shape 8 fill 6\nWeights = 1 to 8\nfor I in 1 to 3\n A (0 till 8) *= (Weights * 13 + I) mod 101 ${accumulate}\n Done = I\nend\nA`;
        const compiled = run(source, true);
        expect(compiled.result).toBe(run(source, false).result);
        expect(compiled.diagnostics.numberLoops).toBe(1);
    }
});
it.each([false, true])('evaluates a captured modulus once after the RHS (%s)', compilation => {
    const source = `use algo
Calls = new queue
fun Calls rhs
 Calls push 3
 return 3
end
fun Calls modulus
 Calls push 7
 return 7
end
A = array 6 5
A (array 0 0) += (Calls rhs) mod (Calls modulus) .accumulate
tuple A (Calls pop) (Calls pop) (Calls len)`;
    expect(run(source, compilation).result).toBe(run('A = array 5 5\ntuple A 3 7 0', false).result);
});
it.each([false, true])('reads captured modulus bindings in array writers (%s)', compilation => {
    const source = `M = 7
fun N update
 A = array 6 5
 A (array 0 0) += N mod M .accumulate
 return A 0
end
First = 3 update
M = 5
Second = 3 update
tuple First Second`;
    expect(run(source, compilation).result).toBe(run('tuple 5 2', false).result);
});
it.each([false, true])('rejects a zero integer modulus on empty selections (%s)', compilation => {
    expect(() => run('A = array 1\nA (0 till 0) *= 3 mod 0 .accumulate', compilation)).toThrow();
});
it.each([false, true])('keeps real modular accumulation in selection order (%s)', compilation => {
    expect(run('A = array 6.0\nA (array 0 0) += 3 mod 2.5 .accumulate\nA', compilation).result).toBe('2');
});
