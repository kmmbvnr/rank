import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, type InterpreterOptions } from '../src/index.js';

function outcome(source: string, options: InterpreterOptions = {}) {
    let loops = 0;
    const runtime = new Interpreter(() => {}, { ...options, onIntegerLoopExecuted: () => loops++ });
    try {
        try { return { value: formatValue(runtime.execute(source)!), loops }; }
        catch (error) { return { error: error instanceof RankError ? error.format() : String(error), loops }; }
    } finally { runtime.dispose(); }
}
function compare(source: string) {
    const reference = outcome(source, { compilation: false });
    const compiled = outcome(source);
    expect({ ...compiled, loops: 0 }).toEqual({ ...reference, loops: 0 });
    return compiled;
}
const sum = (range: string, body = 'Total += P') => `use sequences
Total = 0
for P in ${range}
  ${body}
end
Total`;

describe('compiled loops over primes', () => {
    it.each([
        ['primes till 100', '1060'],
        ['primes to 97', '1060'],
        ['primes from 10 till 50', '311'],
        ['primes after 11 to 47', '300'],
        ['(primes till 50) from 10', '311'],
        ['primes from 2 to 2', '2'],
        ['primes from 50 till 10', '0'],
        ['primes from (Low * 2) till (Low * 10)', '311'],
    ])('iterates %s', (range, expected) => {
        const result = compare(`Low = 5\n${sum(range)}`);
        expect(result.value).toBe(expected);
        expect(result.loops).toBe(1);
    });

    it('binds the ordinal and stops early', () => {
        const result = compare(`use sequences
Total = 0
for P I in primes from 100 till 1000
  if I equal 5
    break
  end
  Total += P * I
end
Total`);
        expect(result.value).toBe('1096');
        expect(result.loops).toBe(1);
    });

    it('keeps ordinary evaluation for other bounds and bindings', () => {
        expect(compare(sum('primes till 10.5')).value).toBe('17');
        expect(compare(sum('primes from 100', 'break')).loops).toBe(0);
        const rebound = compare(`primes = array 4 6 9
${sum('primes till 8')}`);
        expect(rebound.loops).toBe(0);
    });
});
