import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';

describe('lookup', () => {
    it('takes the first array match and keeps missing requests absent', () => {
        const runtime = new Interpreter();
        runtime.execute('use tables\nIds = array 2 1 9\n'
            + 'Keys = array 1 2 2\n'
            + 'Names = array "Ada" "Bea" "Later"\n'
            + 'Found = Ids Keys Names lookup');
        expect(formatValue(runtime.execute('Found 0')!)).toBe('Bea');
        expect(formatValue(runtime.execute('Found 1')!)).toBe('Ada');
        expect(formatValue(runtime.execute('Found 2 default ""')!)).toBe('');
        expect(() => runtime.execute('Found 2')).toThrowError('lookup key not found');
        runtime.execute('Keys 1 = 3');
        expect(formatValue(runtime.execute('Found 0')!)).toBe('Later');
    });

    it('compares numeric keys by value and rejects misaligned sources', () => {
        const runtime = new Interpreter();
        runtime.execute('use tables');
        expect(formatValue(runtime.execute('1.0 (array 1) (array "one") lookup')!))
            .toBe('one');
        expect(() => runtime.execute('(array 1) (array 1 2) (array "one") lookup'))
            .toThrowError('aligned rank-1 arrays');
    });
});
