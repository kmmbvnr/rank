import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('Rank random operations', () => {
    it('returns a shuffled copy without changing its source', () => {
        expect(run([
            'use random',
            'use sequences',
            'Source = array 0 1 2 3 4',
            'Shuffled = Source shuffle',
            'Ok = (Shuffled sort equal Source) and reduce',
            'Ok and= (Source equal array 0 1 2 3 4) and reduce',
            'Ok',
        ].join('\n'))).toBe('true');
    });

    it('uses the host stream only when no seed is supplied', () => {
        let calls = 0;
        const interpreter = new Interpreter(() => {}, {
            random: () => {
                calls += 1;
                return 0;
            },
        });
        const value = interpreter.execute('use random\n(array 1 2 3) shuffle');
        expect(value).toMatchObject({ kind: 'array', items: [2n, 3n, 1n] });
        expect(calls).toBe(2);

        interpreter.execute('use random\n(array 1 2 3) 42 shuffle');
        expect(calls).toBe(2);
    });

    it('repeats a shuffle when given the same seed', () => {
        expect(run([
            'use random',
            'Source = array 0 1 2 3 4',
            'First = Source 42 shuffle',
            'Second = Source 42 shuffle',
            '(First equal Second) and reduce',
        ].join('\n'))).toBe('true');
    });

    it('moves complete cells along the selected axis', () => {
        expect(run([
            'use random',
            'M = array shape 2 3',
            '  1 2 3',
            '  11 12 13',
            'end',
            'M 42 shuffle axis 1',
        ].join('\n'))).toBe('3 1 2 13 11 12');
        expect(run([
            'use random',
            'M = array shape 3 2',
            '  1 2',
            '  3 4',
            '  5 6',
            'end',
            'M 42 shuffle axis 0',
        ].join('\n'))).toBe('5 6 1 2 3 4');
    });

    it('materializes finite sequences and rejects invalid inputs', () => {
        expect(run('use random\nuse ranges\n(0 until 5) 42 shuffle'))
            .toBe('0 4 2 1 3');
        expect(() => run('use random\nuse sequences\nfibonacci shuffle'))
            .toThrowError('shuffle requires a bounded sequence');
        expect(() => run('use random\n(array 1 2) 1.5 shuffle'))
            .toThrowError('shuffle seed must be an integer');
        expect(() => run('use random\n1 shuffle'))
            .toThrowError('shuffle expects an array or finite sequence');
        expect(() => run('use random\n(array 1 2) shuffle axis 1'))
            .toThrowError('shuffle axis out of bounds: 1');
        expect(() => run('(array 1 2) shuffle'))
            .toThrowError('unknown name: shuffle');
    });
});
