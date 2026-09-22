import { describe, expect, it } from 'vitest';
import { RankError } from '../src/index.js';
import { run } from './support.js';

describe('grid operations', () => {
    it('lists only in-bounds cardinal neighbors', () => {
        expect(run([
            'use grids',
            'Grid = array shape 2 3 fill 0',
            'Grid 0 1 neighbors',
        ].join('\n'))).toBe('0 2 0 0 1 1');
    });

    it('includes diagonals with .eight', () => {
        expect(run([
            'use grids',
            'Grid = array shape 3 3 fill 0',
            'Mode = .eight',
            'Grid 1 1 Mode neighbors',
        ].join('\n'))).toBe('1 2 1 0 2 1 0 1 2 2 0 0 2 0 0 2');
    });

    it('keeps all four directions for segments', () => {
        expect(run([
            'use grids',
            'Grid = array shape 3 3',
            '  1 2 3',
            '  4 5 6',
            '  7 8 9',
            'end',
            'Grid 3 segments',
        ].join('\n'))).toBe(
            '1 2 3 4 5 6 7 8 9 1 4 7 2 5 8 3 6 9 1 5 9 3 5 7',
        );
    });

    it('rejects a nonpositive segment width', () => {
        expect(() => run([
            'use grids',
            'Grid = array shape 1 1 fill 0',
            'Grid 0 segments',
        ].join('\n'))).toThrow(RankError);
    });
});
