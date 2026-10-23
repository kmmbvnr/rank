import { describe, expect, it } from 'vitest';
import { run } from './support.js';

describe('mixed-base integer conversions', () => {
    const prefix = 'use numbers\nuse sequences\nBase = array 256 256 256\n';
    it('puts big-endian channel digits before the original axes', () => {
        expect(run(`${prefix}16711680 digits Base`)).toBe('255 0 0');
        expect(run(`${prefix}Pixels = array 16711680 65280 255 16777215 shape 2 2\nRGB = Pixels digits Base\nRGB shape`)).toBe('3 2 2');
        expect(run(`${prefix}Pixels = array 16711680 65280 255 16777215 shape 2 2\nPixels digits Base`))
            .toBe('255 0 0 255 0 255 0 255 0 0 255 255');
        expect(run(`${prefix}Pixels = array 16711680 65280 255 16777215 shape 2 2\n(Pixels digits Base) fromDigits Base`))
            .toBe('16711680 65280 255 16777215');
        expect(run(`${prefix}(16711680 digits Base) fromDigits Base type`)).toBe('.integer');
    });
    it('supports mixed bases and exact integers beyond real precision', () => {
        expect(run('use numbers\n86399 digits (array 24 60 60)')).toBe('23 59 59');
        expect(run('use numbers\n(array 23 59 59) fromDigits (array 24 60 60)')).toBe('86399');
        expect(run('use numbers\nBase = array 10000000000 10000000000\n(99999999999999999999 digits Base) fromDigits Base'))
            .toBe('99999999999999999999');
    });
    it('preserves empty image geometry', () => {
        expect(run(`${prefix}Empty = array shape 0 4 fill 0\nRGB = Empty digits Base\nRGB shape`)).toBe('3 0 4');
        expect(run(`${prefix}Empty = array shape 0 4 fill 0\n(Empty digits Base) fromDigits Base shape`)).toBe('0 4');
    });
    it.each(['-1 digits Base', '16777216 digits Base', '1.5 digits Base',
        '1 digits (array 1 256)', '1 digits (array shape 0 fill 0)',
        '(array 1 2) fromDigits Base', '(array 256 0 0) fromDigits Base',
        '(array 0 -1 0) fromDigits Base'])('rejects invalid operands: %s', source => {
        expect(() => run(prefix + source)).toThrow();
    });
});

describe('integer floor and ceil', () => {
    it('maps reals, preserves exact integers and shapes, and maps sequences', () => {
        expect(run('use numbers\n(array -1.2 -1.0 0.0 1.2) floor')).toBe('-2 -1 0 1');
        expect(run('use numbers\n(array -1.2 -1.0 0.0 1.2) ceil')).toBe('-1 -1 0 2');
        expect(run('use numbers\n99999999999999999999999 floor')).toBe('99999999999999999999999');
        expect(run('use numbers\n99999999999999999999999 ceil')).toBe('99999999999999999999999');
        expect(run('use numbers\n1.2 ceil type')).toBe('.integer');
        expect(run('use numbers\nuse sequences\n((1 to 3) / 2.0) floor copy')).toBe('0 1 1');
        expect(run('use numbers\nuse sequences\n(array 1.2 2.3 3.4 4.5 shape 2 2) ceil shape')).toBe('2 2');
    });
    it.each(['infinity floor', 'nan ceil', '"x" floor'])('rejects %s', source => {
        expect(() => run(`use numbers\n${source}`)).toThrow();
    });
});

it.each(['use numbers\nuse algo', 'use algo\nuse numbers', 'use algo'])
('keeps numeric and ordered floor available together: %s', imports => {
    expect(run(`${imports}\nBag = (array 2 5 9) multiset\ntuple (1.8 floor) (Bag floor 6)`)).toBe('1 5');
});
