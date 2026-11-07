import { expect, it } from 'vitest';
import { ownedArray, typedArray } from '../src/array-storage.js';
import { mapStoredIntegers } from '../src/jit/integer-array-kernel.js';
import { sumValue } from '../src/modules/numbers.js';
import { checkpoint, INTERRUPT_POLL_INTERVAL, withInterrupt } from '../src/interrupt.js';

it.each(['boxed', 'narrow', 'wide', 'computed'] as const)('observes host storage replacement during a %s sum', kind => {
    const input = kind === 'computed' ? mapStoredIntegers(ownedArray([0n, 1n, 2n]), 1n, '+')!
        : kind === 'boxed' ? ownedArray([1n, 2n, 3n])
        : kind === 'narrow' ? typedArray(Int32Array.of(1, 2, 3))
        : typedArray(BigInt64Array.of(1n, 2n, 3n));
    let polls = 0;
    const result = withInterrupt({ length: 1, load: () => 0, store: () => {}, wait: () => {},
        exchange: () => { polls++; input.items[0] = 99n; return 0; },
    }, () => {
        checkpoint(undefined, INTERRUPT_POLL_INTERVAL - 1);
        return sumValue(input);
    });
    expect(polls).toBe(1);
    expect(result).toBe(104n);
});

