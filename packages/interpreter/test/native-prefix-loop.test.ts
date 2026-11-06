import { expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, RankError, formatValue } from '../src/index.js';
import { withDemandBudget } from '../src/interrupt.js';

function run(body: string, compilation = true, budget?: number) {
    const runtime = new Interpreter(() => {}, { compilation });
    const diagnostics = new RuntimeDiagnostics();
    const execute = () => runtime.execute(`use sequences\n${body}`);
    try {
        const value = diagnostics.run(() => budget === undefined ? execute() : withDemandBudget(budget, execute));
        return { result: { value: formatValue(value!) }, diagnostics };
    } catch (error) {
        return { result: { error: error instanceof RankError ? error.format() : String(error),
            a: runtime.variables.has('A') ? formatValue(runtime.variables.get('A')!) : undefined,
            total: String(runtime.variables.get('Total')) }, diagnostics };
    } finally { runtime.dispose(); }
}

const program = (input: string, scan = 'A scan + with 0 copy', extra = '') => `A = ${input}
Total = 0
for K in 1 to 3
 B = ${scan}
 ${extra}
 Total += B sum
end
Total`;

it.each([
    ['array 1 2 3', 'A scan + with 0 copy', '30'],
    ['array -1 2 -3', 'A scan + with 5 copy', '54'],
    ['array 1 2 3', 'A scan + copy', '30'],
    ['array shape 0 fill 1', 'A scan + with 7 copy', '21'],
    ['array shape 0 fill 1', 'A scan + copy', '0'],
])('compiles native integer prefixes: %s / %s', (input, scan, expected) => {
    const source = program(input, scan), actual = run(source);
    expect(actual.result).toEqual(run(source, false).result);
    expect(actual.result).toEqual({ value: expected });
    expect(actual.diagnostics.numberLoops).toBeGreaterThan(0);
});

it.each([
    ['array 9007199254740991 1 -1', 'A scan + with 0 copy'],
    ['array 1 0 2', '(A // A) scan + with 0 copy'],
    ['array 1 0 2', '(A // A) scan + with (1 // 0) copy'],
    ['array 1 2 3', 'A scan + with 0.0 copy'],
])('preserves overflow, errors and scalar kinds: %s / %s', (input, scan) => {
    const source = program(input, scan);
    expect(run(source).result).toEqual(run(source, false).result);
});

it('completes a prefix before mutation through either alias', () => {
    const source = program('array 1 2 3', 'A scan + with 0 copy', 'Alias = B\n A 0 += 10\n B 0 = 99\n Total += Alias sum');
    expect(run(source).result).toEqual(run(source, false).result);
    expect(run(source).diagnostics.numberLoops).toBeGreaterThan(0);
});

it.each([1, 20, 100])('retains observable budget boundaries at %s', budget => {
    const source = program('1 to 100 copy');
    expect(run(source, true, budget).result).toEqual(run(source, false, budget).result);
});

it('rechecks syntax after a formerly unbound scan name is rebound', () => {
    const source = `fun A prefix_sum
 Total = 0
 for K in 1 to 2
  B = A scan + with 0 copy
  Total += B sum
 end
 return Total
end
A = array 1 2 3
First = A prefix_sum
scan = 0
A prefix_sum`;
    expect(run(source).result).toEqual(run(source, false).result);
    expect(run(source).result.error).toBeDefined();
});
