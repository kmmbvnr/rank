import { describe, expect, it } from 'vitest';
import { fitsIntegerRepresentation, integerInput } from '../src/jit/integer-representation.js';

describe('integer representation proofs', () => {
    it('does not confuse semantic integer with a real Number', () => {
        expect(integerInput(1, 'safe-number')).toBeUndefined();
        expect(integerInput(1n, 'safe-number')).toBe(1);
        expect(integerInput(1n, 'bigint')).toBe(1n);
    });

    it.each([-1n, 1n])('guards both range boundaries, sign %s', sign => {
        const safe = sign * 9007199254740991n;
        expect(integerInput(safe, 'safe-number')).toBe(Number(safe));
        expect(integerInput(safe + sign, 'safe-number')).toBeUndefined();
        expect(integerInput(safe + sign, 'bigint')).toBe(safe + sign);
        const compact = sign < 0 ? -2147483648n : 2147483647n;
        expect(integerInput(compact, 'int32')).toBe(Number(compact));
        expect(integerInput(compact + sign, 'int32')).toBeUndefined();
        expect(integerInput(compact + sign, 'safe-number')).toBe(Number(compact + sign));
    });

    it('requires a complete safe interval to remove Int32 store guards', () => {
        expect(fitsIntegerRepresentation(undefined, 'int32')).toBe(false);
        expect(fitsIntegerRepresentation([-2147483648, 2147483647], 'int32')).toBe(true);
        expect(fitsIntegerRepresentation([-2147483649, 2147483647], 'int32')).toBe(false);
        expect(fitsIntegerRepresentation([0, 2147483648], 'int32')).toBe(false);
        expect(fitsIntegerRepresentation([1, 0], 'int32')).toBe(false);
        expect(fitsIntegerRepresentation([0, Infinity], 'safe-number')).toBe(false);
        expect(fitsIntegerRepresentation([0, 1.5], 'safe-number')).toBe(false);
        expect(fitsIntegerRepresentation(undefined, 'bigint')).toBe(true);
    });
});
