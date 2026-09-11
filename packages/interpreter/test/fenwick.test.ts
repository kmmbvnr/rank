import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('fenwick tree', () => {
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

    it('exposes missing indexed positions to pad', () => {
        expect(run([
            'use algo',
            'F = 2 fenwick',
            'Result = array shape 3',
            '  (F (-1) pad 9)',
            '  (F 2 pad 8)',
            '  (F sum 2 pad 7)',
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
