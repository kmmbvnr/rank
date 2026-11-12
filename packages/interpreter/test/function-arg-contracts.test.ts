import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue } from '../src/index.js';

function outcome(source: string, compilation: boolean): string {
    const runtime = new Interpreter(() => {}, { compilation });
    try {
        const value = runtime.execute(source);
        return value === undefined ? 'undefined' : formatValue(value);
    } catch (error) {
        return error instanceof RankError ? error.format().split('\n')[0] : String(error);
    } finally { runtime.dispose(); }
}

const scale = (contracts: string) => `use numbers
fun X scale Factor
${contracts}  return X * Factor
end
`;

describe.each([false, true])('arg contracts inside fun (compilation=%s)', compilation => {
    const run = (source: string) => outcome(source, compilation);

    it('accepts a call that meets every contract', () => {
        const source = scale('  arg X real shape 2\n  arg Factor real\n') + '(array 1.0 2.0) scale 4.0';
        expect(run(source)).toBe('4 8');
    });

    it.each([
        ['  arg X real shape 2\n', '(array 1.0 2.0 3.0) scale 4.0', 'X expects real array shape 2, got array shape 3'],
        ['  arg X real shape 2 2\n', '(array 1.0 2.0) scale 4.0', 'X expects real array shape 2 2, got array shape 2'],
        ['  arg Factor real\n', '(array 1.0) scale 4', 'Factor expects real, got integer'],
        ['  arg X integer array\n', '(array 1.5 2.5) scale 2', 'X expects integer array, got array shape 2'],
        ['  arg X integer array\n', '5 scale 2', 'X expects integer array, got integer'],
        ['  arg X integer shape 2\n', '5 scale 2', 'X expects integer array shape 2, got integer'],
        ['  arg Factor integer shape 1\n', '(array 1) scale 2', 'Factor expects integer array shape 1, got integer'],
    ])('rejects %j on %s', (contracts, call, message) => {
        expect(run(scale(contracts) + call)).toContain(message);
    });

    it('keeps an unconstrained function valid for any type and shape', () => {
        const source = scale('') + '(array 1 2) scale 3\n(array 1.5) scale 2.0\n4 scale 5';
        expect(run(source)).toBe('20');
        expect(run(scale('  arg Factor integer\n') + '(array 1 2) scale 3\n(array 1 2 3) scale 4')).toBe('4 8 12');
    });

    it('does not constrain the parameters it does not name', () => {
        const source = scale('  arg Factor integer\n') + '(array 1.5 2.5) scale 2';
        expect(run(source)).toBe('3 5');
    });

    it('checks every call of a hot function', () => {
        const source = `use numbers
fun X twice
  arg X integer
  return X * 2
end
Total = 0
for N in 1 to 300
  Total += N twice
end
Total`;
        expect(run(source)).toBe('90300');
        expect(run(source.replace('Total += N twice', 'Total += (N + 0.5) twice'))).toContain('X expects integer, got real');
    });

    it('checks lazily produced arguments', () => {
        const source = scale('  arg X integer array\n') + '(1 to 4) scale 2 sum';
        expect(run(source)).toBe(run(scale('') + '(1 to 4) scale 2 sum'));
    });

    it('does not require use cli', () => {
        expect(run('fun X f\n  arg X integer\n  return X\nend\n3 f')).toBe('3');
    });

    it('reports misplaced, unknown and defaulted declarations before running', () => {
        expect(run(scale('  arg Y real\n') + '1 scale 2')).toContain('function scale has no parameter Y');
        expect(run(scale('  arg X real\n  arg X real\n') + '1.0 scale 2.0')).toContain('arg X is declared twice');
        expect(run('use numbers\nfun X f\n  Z = 1\n  arg X integer\n  return X\nend\n3 f')).toContain('arg X must come first');
        expect(run('use numbers\nfun X f\n  if true\n    arg X integer\n  end\n  return X\nend\n3 f')).toContain('arg X must come first');
        expect(run(scale('  arg Factor real = 2\n') + '1.0 scale 2.0')).toContain('takes its default from a call group');
    });

    it('matches the unannotated result when every contract holds', () => {
        const plain = scale('') + '(array 1.0 2.0) scale 4.0';
        const annotated = scale('  arg X real shape 2\n  arg Factor real\n') + '(array 1.0 2.0) scale 4.0';
        expect(run(annotated)).toBe(run(plain));
    });
});

it('gives the same result with compilation on and off', () => {
    const source = scale('  arg X real shape 3\n') + '(array 1.0 2.0 3.0) scale 2.0 sum';
    expect(outcome(source, true)).toBe(outcome(source, false));
});
