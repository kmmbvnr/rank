import { expect, it } from 'vitest';
import { Interpreter, RankError, RuntimeDiagnostics, formatValue, parse } from '../src/index.js';
import { native } from '../src/modules/shared.js';

function run(source: string, compilation = true, numberLoopCompilation = true) {
    const runtime = new Interpreter(() => {}, { compilation, numberLoopCompilation, scalarEntryCompilation: false });
    const diagnostics = new RuntimeDiagnostics();
    try {
        let error: string | undefined;
        try { diagnostics.run(() => runtime.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        return { diagnostics, observation: { error,
            variables: [...runtime.variables].map(([name, value]) => [name, formatValue(value)]),
        } };
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const result = run(source);
    expect(result.observation).toEqual(run(source, false).observation);
    expect(result.observation).toEqual(run(source, true, false).observation);
    return result;
}
const cases = [
    ['isqrt', '0 1 2 15 16 17 9007199254740991'],
    ['sqrt', '0 1 2 15 16 17'],
    ['abs', '-2147483648 -17 0 17'],
    ['abs', '-0.0 0.0 -1.5 2.5'],
    ['floor', '-1.5 -0.0 0.0 1.5'],
    ['ceil', '-1.5 -0.0 0.0 1.5'],
    ['floor', '-1.0e30 1.0e30'],
    ['ceil', '-1.0e30 1.0e30'],
    ['log', '0.5 1.0 2.0 4.0'],
    ['acos', '-1.0 -0.5 0.0 0.5 1.0'],
    ['odd', '-3 -2 -1 0 1 2 3'],
    ['even', '-3 -2 -1 0 1 2 3'],
];
it.each(cases)('fuses array %s with a reduction', (operation, values) => {
    const source = `use numbers
use sequences
A = array ${values}
Total = 0.0
for I in 1 to 2
 B = A ${operation}
 Total += B ${['odd', 'even'].includes(operation) ? 'count' : 'sum'}
end`;
    const result = compare(source);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['0 3', '2 3'])('preserves multidimensional shapes for %s', dimensions => {
    const result = compare(`use numbers
use sequences
A = array shape ${dimensions} fill 9
Total = 0
for I in 1 to 2
 B = A isqrt
 Total += B sum
end`);
    expect(result.observation.error).toBeUndefined();
    expect(result.diagnostics.numberLoops).toBe(1);
});
it.each(['isqrt', 'sqrt', 'log', 'acos'])('replays a vector domain error through %s', operation => {
    const values = operation === 'acos' ? '0 2' : operation === 'log' ? '1 0' : '1 -1';
    const result = compare(`use numbers
A = array ${values}
Total = 0.0
for I in 1 to 2
 B = A ${operation}
 Total += B sum
end`);
    expect(result.observation.error).toBeDefined();
});
it('replays wide integer unary values exactly', () => {
    const result = compare(`use numbers
A = array 9007199254740992 18446744073709551616
Total = 0
for I in 1 to 2
 B = A isqrt
 Total += B sum
end`);
    expect(result.observation.error).toBeUndefined();
});
it('rechecks a rebound builtin in a cached vector loop', () => {
    const runtime = new Interpreter(() => {}, { scalarEntryCompilation: false });
    try {
        runtime.execute('use numbers\nA = array 0 1 4 9\nB = A\nTotal = 0');
        const program = parse('for I in 1 to 2\n B = A isqrt\n Total += B sum\nend');
        const diagnostics = new RuntimeDiagnostics();
        diagnostics.run(() => runtime.executeProgram(program));
        expect(diagnostics.numberLoops).toBe(1);
        const seen: unknown[] = [];
        runtime.variables.set('isqrt', { ...native('replacement', 1, ([value]) => { seen.push(value); return 7n; }), monadicRank: 0 });
        runtime.executeProgram(program);
        expect(formatValue(runtime.variables.get('B')!)).toBe('7 7 7 7');
        expect(seen).toEqual([0n, 1n, 4n, 9n, 0n, 1n, 4n, 9n]);
    } finally { runtime.dispose(); }
});
