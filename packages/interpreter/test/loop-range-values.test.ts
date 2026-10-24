import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue } from '../src/index.js';

function run(source: string, compilation: boolean) {
    const runtime = new Interpreter(undefined, { compilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    let error: string | undefined;
    try {
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { compiledLoops: diagnostics.compiledLoops, observation: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]) } };
    } finally { runtime.dispose(); }
}
function compare(body: string, setup = 'A = array shape 20 fill 7\nResult = array shape 0 fill 0') {
    const source = `use sequences\n${setup}\nfor K in 1 to 5\n${body}\nend`;
    const compiled = run(source, true);
    expect(compiled.observation).toEqual(run(source, false).observation);
    expect(compiled.compiledLoops).toBe(1);
    return compiled.observation;
}

describe('range values in compiled loops (#432)', () => {
    it.each([
        'Result = K to 3 * K by K',
        'Result = A (K to 3 * K by K)',
        'Result = (K to 9) copy',
        'Result = A ((K to 9) // 2)',
        'A (1 to 3) -= 1',
        'A (1 to 3) = (A (1 to 3) - 1) mod 7',
        'A (K to 3 * K by K) -= A (K to 3 * K by K) - K',
        'Result = A (9 till K by -2)',
        'Result = A (K to 3 * K by K) copy',
    ])('compiles %s', body => {
        expect(compare(body).error).toBeUndefined();
    });

    it.each(['3 to 1', '3 till 3', '9 to 1 by -2', '0 till 9 by 2', '1 to 9 by 0', '9223372036854775808 to 9223372036854775810'])('matches range semantics: %s', range => {
        compare(`Result = (${range}) copy`);
    });

    it.each(['-1 to 2', '18 to 22', '22 to 18 by -2'])('matches selection errors: %s', range => {
        compare(`Result = A (${range})`);
    });

    it.each([
        'A (1 to 3) = A (1 to 2)',
        'A (3 till 3) = A (1 to 2)',
        'A (1 to 3) = (A (1 to 3) // 0)',
        'A (1 to 3) = (A (1 to 3) mod -3)',
        'A (3 to 1 by -1) += A (1 to 3)',
        'A (1 to 3) = (A (1 to 3) - A (3 to 1 by -1))',
        'Result = A (1 to 6 by 2)\n Result (0 to 2) += Result (2 to 0 by -1)',
        'Result = A (K to 20 by K) copy',
    ])('matches vector writes and errors: %s', body => {
        compare(body);
    });

    it('keeps copy binding guards for stepped slices', () => {
        const source = `fun X copy
 return X
end
A = array shape 20 fill 7
for K in 1 to 5
 Result = A (K to 3 * K by K) copy
end`;
        const result = run(source, true);
        expect(result.observation).toEqual(run(source, false).observation);
        expect(result.compiledLoops).toBe(0);
    });

    it('snapshots selections before later source and result writes', () => {
        expect(compare('Result = A (K to 3 * K by K)\n A K = K\n Result 0 = 99').error).toBeUndefined();
    });
});
