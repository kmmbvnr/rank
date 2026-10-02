import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('min and max over text', () => {
    it('compares text like less and greater', () => {
        expect(run('"B" "A" min')).toBe('A');
        expect(run('"A" "Z" max')).toBe('Z');
        expect(run('Best = "Z"\nBest = Best "C" min\nBest')).toBe('C');
    });

    it('reduces arrays of text', () => {
        expect(run('A = array "b" "c" "a"\nA min')).toBe('a');
        expect(run('A = array "b" "c" "a"\nA max')).toBe('c');
    });

    it('rejects mixed text and numbers', () => {
        expect(() => run('"A" 1 min')).toThrow();
    });
});
