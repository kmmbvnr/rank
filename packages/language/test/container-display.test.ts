import { expect, it } from 'vitest';
import { operations } from '../src/operations.js';
import { displayTypeName, formatTypeSignature, operationSignature } from '../src/type-signature.js';

it('never exposes collection implementation names or kind inventories in catalogue signatures', () => {
    const implementations = /(?<![.\w])(?:array|sequence|queue|stack|deque|heap|set|counter|multiset|index|graph|dsu|segment|fenwick|wavelet|functional|table|view)\b/;
    for (const operation of operations) {
        for (const compact of [false, true]) {
            const signature = operationSignature(operation, undefined, { compact });
            if (signature) {
                expect(signature, operation.name).not.toMatch(implementations);
                expect(signature, operation.name).not.toContain('c:');
            }
        }
        for (const row of operation.signatures ?? [])
            expect(formatTypeSignature(row), operation.name).not.toMatch(implementations);
    }
});

it('handles future collection kinds without extending a display inventory', () => {
    expect(displayTypeName('future-collection')).toBe('c');
    expect(displayTypeName('integer')).toBe('integer');
    expect(displayTypeName('text')).toBe('text');
    expect(displayTypeName('sqlite-expression')).toBe('column');
});

it('reserves c for containers while preserving independent element variables and proven axes', () => {
    expect(formatTypeSignature({ inputs: [
        { collection: 'array', element: { variable: 0 }, shape: [3, 4] },
        { collection: 'queue', element: { variable: 1 } },
        { variable: 2 },
    ], result: { collection: 'stack', element: { variable: 0 } } }))
        .toBe('c[3, 4]<a> c<b> d → c<a>');
});
