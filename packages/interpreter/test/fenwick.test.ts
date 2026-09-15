import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('fenwick tree', () => {
    it.each(['', 'use numbers'])('continues prefix sum pipelines with %s', numbers => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line));
        expect(runtime.execute(`
use algo
use io
use text
use sequences
${numbers}
F = 3 fenwick
F 0 = 2
F 1 = 5
F sum 1 print
`)).toBe(7n);
        expect(runtime.execute('F sum 1 text len print')).toBe(1n);
        expect(runtime.execute('(F sum 1) + 0')).toBe(7n);
        expect(runtime.execute('F sum 3 default 42')).toBe(42n);
        expect(runtime.execute(`
Holder = record
  .tree = F
end
Holder .tree sum (1 print) print
`)).toBe(7n);
        expect(runtime.execute(`
fun source N
  N print
  return F
end
9 source sum 1 print
`)).toBe(7n);
        expect(output).toEqual(['7', '1', '1', '7', '9', '7']);
        runtime.dispose();
    });

    it('keeps user-defined sum arity and dispatches each new receiver', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line));
        expect(runtime.execute(`
use algo
use io
fun sum A B
  return A + B
end
F = 2 fenwick
F 0 = 7
F sum 1 3 sum print
`)).toBe(10n);
        expect(output).toEqual(['10']);
        runtime.dispose();
    });

    it('does not claim ordinary sum pipelines or evaluate their receiver twice', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line));
        expect(runtime.execute(`
use numbers
use io
fun source N
  N print
  return array 1 2 3
end
(7 source) sum print
`)).toBe(6n);
        expect(output).toEqual(['7', '6']);
        runtime.execute('use algo\n(array 4 5) sum print');
        expect(output.at(-1)).toBe('9');
        runtime.execute('use sequences\n(1 to 3) array sum print');
        expect(output.at(-1)).toBe('6');
        runtime.execute('fun replacement A\n  return 99\nend');
        runtime.variables.set('sum', runtime.variables.get('replacement')!);
        expect(runtime.execute('(array 1 2) sum print')).toBe(99n);
        runtime.dispose();
    });

    it('stores integer cells and computes inclusive prefix sums', () => {
        expect(run([
            'use algo',
            'F = 5 fenwick',
            'F 0 = 2',
            'F 2 = 5',
            'F 2 += 3',
            'F 4 -= 1',
            'Result = array shape 7',
            '  (F 0) (F 2) (F 4)',
            '  (F sum 0) (F sum 1)',
            '  (F sum 2) (F sum 4)',
            'end',
            'Result',
        ].join('\n'))).toBe('2 8 -1 2 2 10 9');
    });

    it('treats prefix minus one as empty', () => {
        expect(run([
            'use algo',
            'F = 3 fenwick',
            'F 0 = 7',
            'F sum (-1)',
        ].join('\n'))).toBe('0');
    });

    it('exposes missing indexed positions to default', () => {
        expect(run([
            'use algo',
            'F = 2 fenwick',
            'Result = array shape 3',
            '  (F (-1) default 9)',
            '  (F 2 default 8)',
            '  (F sum 2 default 7)',
            'end',
            'Result',
        ].join('\n'))).toBe('9 8 7');
    });

    it('has a fixed nonnegative size and integer values', () => {
        expect(run('use algo\n3 fenwick type')).toBe('.fenwick');
        expect(() => run('use algo\n(-1) fenwick'))
            .toThrowError('fenwick size must be nonnegative');
        expect(() => run('use algo\nF = 2 fenwick\nF 0 = 1.5'))
            .toThrowError('fenwick values must be integers');
    });

    it('requires the algorithm module', () => {
        expect(() => run('3 fenwick'))
            .toThrowError('unknown name: fenwick; did you forget `use algo`?');
    });

    it('does not capture sum in an ordinary application chain', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line));
        expect(runtime.execute([
            'use algo',
            'use io',
            'use numbers',
            'A = array 1 2 3',
            'A sum print',
        ].join('\n'))).toBe(6n);
        expect(output).toEqual(['6']);
    });
});
