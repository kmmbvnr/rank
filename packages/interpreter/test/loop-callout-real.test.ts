import {describe, expect, it} from 'vitest';
import {Interpreter, RankError, RuntimeDiagnostics, formatValue} from '../src/index.js';
import {native} from '../src/modules/shared.js';
import type {RankValue} from '../src/value.js';

function run(source: string, compilation: boolean, numberLoopCompilation = true) {
    const r = new Interpreter(() => {}, {compilation, numberLoopCompilation}), d = new RuntimeDiagnostics();
    try {
        let result: RankValue | undefined, error: string | undefined;
        try { result = d.run(() => r.execute(source)); }
        catch (cause) { error = cause instanceof RankError ? cause.format() : String(cause); }
        return {result: result === undefined ? undefined : formatValue(result), error,
            values: [...r.variables].map(([name, value]) => [name, formatValue(value)]),
            loops: d.compiledLoops, numberLoops: d.numberLoops};
    } finally {r.dispose();}
}
function compare(source: string, number = true) {
    const actual = run(source, true, number), reference = run(source, false);
    expect({...actual, loops: 0, numberLoops: 0}).toEqual(reference);
    return actual;
}

describe('real values across exact-loop interpreter callouts', () => {
    it.each(['0.5', '-0.0', '1.0e308 ** 2'])('publishes real %s before an integer callout', value => {
        const result = compare(`use numbers
Total = 0
for I in 1 to 3
  X = ${value}
  if I equal 2
    Total += (tuple X I Total) len
  end
end
Total`);
        expect(result.result).toBe('3');
        expect(result.loops).toBe(1);
    });
    it('keeps a real callback result instead of truncating it', () => {
        const result = compare(`use numbers
use stats
Total = 0.0
for I in 1 to 3
  if I greater 0
    X = (array (I / 2) 0.25) mean
    Total += X
  end
end
Total`);
        expect(result.result).toBe('1.875');
        expect(result.loops).toBe(1);
        expect(result.numberLoops).toBe(0);
    });
    it('guards the catalogued result type when a callout function is rebound', () => {
        const r = new Interpreter(), d = new RuntimeDiagnostics();
        const source = `Total = 0.0
for I in 1 to 3
  if I greater 0
    Total += (array 0.5 0.25) mean
  end
end
Total`;
        try {
            r.execute('use stats');
            expect(d.run(() => r.execute(source))).toBe(1.125);
            const loops = d.compiledLoops;
            expect(loops).toBe(1);
            r.variables.set('mean', native('mean', 1, () => 0.25));
            expect(d.run(() => r.execute(source))).toBe(0.75);
            expect(d.compiledLoops).toBe(loops);
        } finally {r.dispose();}
    });
    it('publishes boolean, integer and array locals too', () => {
        const result = compare(`Total = 0
for I in 1 to 3
  X = I / 2
  Flag = I less 3
  A = array shape 2 fill 7
  if Flag
    Total += (tuple X Flag I A) len
  end
end
Total`);
        expect(result.result).toBe('8');
        expect(result.loops).toBe(1);
    });
    it('does not evaluate a callout in a skipped branch', () => {
        expect(compare(`use numbers
for I in 1 to 3
  X = I / 2
  if I less 0
    Y = (tuple X) log
  end
end`).error).toBeUndefined();
    });
    it('preserves earlier writes and the callout error', () => {
        expect(compare(`use numbers
Before = 0.0
for I in 1 to 3
  Before = I / 2
  if I equal 2
    Y = (tuple -1.0) log
  end
end`).error).toContain('log expects numeric input');
    });
});

describe('scalar log in compiled loops', () => {
    it.each([true, false])('compiles with Number backend enabled=%s', number => {
        const result = compare(`use numbers
Total = 0.0
for I in 1 to 10
  Total += (I log) + ((I / 2) log)
end
Total`, number);
        expect(result.error).toBeUndefined();
        expect(result.loops).toBe(1);
        expect(result.numberLoops).toBe(Number(number));
    });
    it.each(['0', '-1', '0.0', '-0.0', '-1.5', 'nan', 'infinity', '10 ** 400'])('preserves the log domain error for %s', value => {
        const source = `use numbers\nBefore = 0\nfor I in 1 to 3\n Before = I\n X = (${value}) log\nend`;
        expect(compare(source).error).toContain('log input is outside its domain');
        expect(compare(source, false).error).toContain('log input is outside its domain');
    });
    it('skips invalid log inputs in inactive branches', () => {
        expect(compare(`use numbers
Total = 0.0
for I in 1 to 3
  if I less 0
    Total += (-1 log)
  else
    Total += I log
  end
end
Total`).error).toBeUndefined();
    });
    it('rechecks the log implementation on every entry', () => {
        const r = new Interpreter(), d = new RuntimeDiagnostics();
        try {
            r.execute('use numbers');
            const source = 'Total = 0.0\nfor I in 1 to 3\n Total += I log\nend\nTotal';
            expect(d.run(() => r.execute(source))).toBe(Math.log(1) + Math.log(2) + Math.log(3));
            r.variables.set('log', native('log', 1, () => 0.25));
            expect(d.run(() => r.execute(source))).toBe(0.75);
        } finally {r.dispose();}
    });
});
