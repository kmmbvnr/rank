import { expect, it } from 'vitest';
import { rankedFunctionFacts } from '../src/analysis/ranked-function-facts.js';
import type { ValueFacts } from '../src/analysis/value-domain.js';

const matrix: ValueFacts = { types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'], eagerScalarCells: true };
const integer: ValueFacts = { types: ['integer'], rank: 0, shape: [] };

it('passes scalar cells and broadcasts independent dyadic frames', () => {
    const result = rankedFunctionFacts([matrix, integer], [0, 0], inputs => {
        expect(inputs).toEqual([integer, integer]);
        return integer;
    });
    expect(result).toEqual({ types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'] });
});

it('stacks array results but boxes text and tuple results', () => {
    const row: ValueFacts = { types: ['array'], rank: 1, shape: [3], elements: ['integer'], eagerScalarCells: true };
    expect(rankedFunctionFacts([matrix], [-1], inputs => {
        expect(inputs).toEqual([row]);
        return row;
    })).toEqual({ types: ['array'], rank: 2, shape: [2, 3], elements: ['integer'] });
    for (const value of [{ types: ['text'], rank: 1, shape: [null] },
        { types: ['tuple'], rank: 0, shape: [], tupleItems: [integer] }] satisfies ValueFacts[]) {
        expect(rankedFunctionFacts([matrix], [1], () => value))
            .toEqual({ types: ['array'], rank: 1, shape: [2], elements: value.types });
    }
});

it('preserves inferred result cell axes under empty and unknown frames', () => {
    expect(rankedFunctionFacts([{ ...matrix, shape: [0, 3] }], [1], () => matrix))
        .toEqual({ types: ['array'], rank: 3, shape: [0, 2, 3], elements: ['integer'] });
    expect(rankedFunctionFacts([{ ...matrix, shape: [null, 3] }], [1], () => matrix))
        .toEqual({ types: ['array'], rank: 3, shape: [null, 2, 3], elements: ['integer'] });
    expect(rankedFunctionFacts([{ ...matrix, shape: [null, 3] }], [1], () => integer))
        .toEqual({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
});

it('uses explicit frame axes and declines incompatible frames', () => {
    expect(rankedFunctionFacts([matrix], [1], inputs => {
        expect(inputs[0].shape).toEqual([2]);
        return integer;
    }, [1])).toEqual({ types: ['array'], rank: 1, shape: [3], elements: ['integer'] });
    for (const axes of [[0, 0], [2], [-1]]) {
        expect(rankedFunctionFacts([matrix], [1], () => integer, axes)).toEqual({ types: [] });
    }
    expect(rankedFunctionFacts([matrix, { ...matrix, shape: [4, 3] }], [1, 1], () => integer))
        .toEqual({ types: [] });
});

it('does not freeze input cell values or infer text and sequence mapping as array mapping', () => {
    expect(rankedFunctionFacts([{ ...matrix, integers: [1, 2, 3, 4, 5, 6] }], [0], inputs => {
        expect(inputs[0].integer).toBeUndefined();
        return integer;
    }).elements).toEqual(['integer']);
    for (const types of [['text'], ['sequence']]) {
        expect(rankedFunctionFacts([{ types, rank: 1, shape: [3], elements: ['integer'] }], [0], () => integer))
            .toEqual({ types: [] });
    }
});
