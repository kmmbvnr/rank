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

    it('draws choices independently with replacement', () => {
        const draws = [0, 0.9, 0.4];
        let calls = 0;
        const interpreter = new Interpreter(() => {}, {
            random: () => draws[calls++],
        });
        expect(interpreter.execute([
            'use random',
            'Values = array 10 20 30',
            'Values 3 choices',
        ].join('\n'))).toEqual({
            kind: 'array',
            items: [10n, 30n, 20n],
            shape: [3],
        });
        expect(calls).toBe(3);
    });

    it('draws complete leading-axis cells', () => {
        const interpreter = new Interpreter(() => {}, { random: () => 0.6 });
        expect(interpreter.execute([
            'use random',
            'M = array shape 2 2',
            '  1 2',
            '  3 4',
            'end',
            'M 3 choices',
        ].join('\n'))).toEqual({
            kind: 'array',
            items: [3n, 4n, 3n, 4n, 3n, 4n],
            shape: [3, 2],
        });
    });

    it('validates choice counts and sources', () => {
        expect(new Interpreter().execute([
            'use random',
            'A = array shape 0 2 fill 0',
            'A 0 choices',
        ].join('\n'))).toEqual({ kind: 'array', items: [], shape: [0, 2] });
        expect(() => run('use random\n(array 1 2) (-1) choices'))
            .toThrowError('choices count must be nonnegative');
        expect(() => run('use random\nA = array shape 0 fill 0\nA 1 choices'))
            .toThrowError('choices cannot draw from an empty input');
        expect(() => run('use random\n1 2 choices'))
            .toThrowError('choices expects an array or finite sequence');
        expect(() => run('use random\nuse sequences\nfibonacci 2 choices'))
            .toThrowError('choices requires a bounded sequence');
    });

    it('fills uniform tensors from the shared stream', () => {
        const draws = [0, 0.25, 0.5, 0.75];
        let calls = 0;
        const interpreter = new Interpreter(() => {}, {
            random: () => draws[calls++],
        });
        expect(interpreter.execute([
            'use random',
            'Shape = array 2 2',
            'Low = -2',
            'Shape Low 2 uniform',
        ].join('\n'))).toEqual({
            kind: 'array',
            items: [-2, -1, 0, 1],
            shape: [2, 2],
        });
        expect(calls).toBe(4);
    });

    it('repeats uniform tensors after reseeding', () => {
        expect(run([
            'use random',
            'Shape = array 2 3',
            'State = 42 seed',
            'First = Shape 0 1 uniform',
            'State = 42 seed',
            'Second = Shape 0 1 uniform',
            '(First equal Second) and reduce',
        ].join('\n'))).toBe('true');
    });

    it('validates uniform shapes and bounds', () => {
        expect(run([
            'use random',
            'use sequences',
            'Shape = array 0 3',
            'A = Shape 1 2 uniform',
            'A shape',
        ].join('\n'))).toBe('0 3');
        expect(() => run('use random\n1 0 1 uniform'))
            .toThrowError('uniform shape must be a rank-1 integer array');
        expect(() => run('use random\n(array 2 -1) 0 1 uniform'))
            .toThrowError('uniform dimension must be nonnegative');
        expect(() => run('use random\n(array 2) 2 1 uniform'))
            .toThrowError('uniform lower bound must not exceed upper bound');
        expect(() => run('use random\n(array 2) "low" 1 uniform'))
            .toThrowError('uniform lower bound must be numeric');
    });

    it('reseeds the shared stream used by imported functions', () => {
        const interpreter = new Interpreter(undefined, {
            loadModule: () => ({
                id: 'draw.ra',
                source: [
                    'use random',
                    'fun draw Values',
                    '  return Values shuffle',
                    'end',
                ].join('\n'),
            }),
        });
        const value = interpreter.execute([
            'use random',
            'use "draw"',
            'Values = array 0 1 2 3 4',
            'State = 42 seed',
            'First = Values draw',
            'State = 42 seed',
            'Second = Values draw',
            '(First equal Second) and reduce',
        ].join('\n'));
        expect(value).toBe(true);
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
        expect(run('use random\n(0 until 5) 42 shuffle'))
            .toBe('0 4 2 1 3');
        expect(() => run('use random\nuse sequences\nfibonacci shuffle'))
            .toThrowError('shuffle requires a bounded sequence');
        expect(() => run('use random\n(array 1 2) 1.5 shuffle'))
            .toThrowError('shuffle seed must be an integer');
        expect(() => run('use random\n1.5 seed'))
            .toThrowError('seed expects an integer');
        expect(() => run('use random\n1 shuffle'))
            .toThrowError('shuffle expects an array or finite sequence');
        expect(() => run('use random\n(array 1 2) shuffle axis 1'))
            .toThrowError('shuffle axis out of bounds: 1');
        expect(() => run('(array 1 2) shuffle'))
            .toThrowError('unknown name: shuffle');
        expect(() => run('42 seed'))
            .toThrowError('unknown name: seed');
    });
});
