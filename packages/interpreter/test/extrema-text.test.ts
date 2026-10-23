import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('min and max over text', () => {
    it('compares text like less and greater', () => {
        expect(run('"B" min "A"')).toBe('A');
        expect(run('"A" max "Z"')).toBe('Z');
        expect(run('Best = "Z"\nBest = Best min "C"\nBest')).toBe('C');
    });

    it('reduces arrays of text', () => {
        expect(run('A = array "b" "c" "a"\nA min')).toBe('a');
        expect(run('A = array "b" "c" "a"\nA max')).toBe('c');
    });

    it('rejects mixed text and numbers', () => {
        expect(() => run('"A" min 1')).toThrow();
    });
});
