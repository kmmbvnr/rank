import { expect, it } from 'vitest';
import { addDims, compareDims, constantDim, formatDim, freshDim, sameDim, variableDim } from '../src/analysis/shape-index.js';

it('canonicalizes sums so that x+y+5+x equals (x+x)+5+y', () => {
    const x = variableDim('x');
    const y = variableDim('y');
    const left = addDims(x, y, constantDim(5), x);
    const right = addDims(addDims(x, x), constantDim(5), y);
    expect(sameDim(left, right)).toBe(true);
    expect(formatDim(left)).toBe('2x + y + 5');
    expect(compareDims(left, right)).toBe('equal');
});

it('proves equal and distinct only when the forms allow it', () => {
    const x = variableDim('x');
    expect(compareDims(constantDim(3), constantDim(4))).toBe('distinct');
    expect(compareDims(x, addDims(x, constantDim(1)))).toBe('unknown');
    expect(compareDims(x, variableDim('y'))).toBe('unknown');
    expect(compareDims(constantDim(3), x)).toBe('unknown');
    expect(compareDims(freshDim(), freshDim())).toBe('unknown');
});
