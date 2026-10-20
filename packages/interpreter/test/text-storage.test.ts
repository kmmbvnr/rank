import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, MissingValueError } from '../src/index.js';
import { textAt, textLength, textPoints } from '../src/text-storage.js';
import { selectAxis } from '../src/selectors.js';

describe('code-point text storage', () => {
    it('uses string storage for decimal/BMP text and lone surrogates', () => {
        for (const text of ['', '1234567890', 'ёж', 'é', '\ud800x\udc00']) {
            expect(textPoints(text)).toBe(text);
        }
        expect(textPoints('a😀é')).toEqual(['a', '😀', 'e', '́']);
    });

    it.each(['', '1234567890', 'ёж', 'a😀é', '\ud800x\udc00', '\ud800\udc00'])('matches Unicode iteration for %j', text => {
        const points = [...text];
        expect(textLength(text)).toBe(points.length);
        points.forEach((point, index) => {
            expect(textAt(text, BigInt(index))).toBe(point);
            expect(selectAxis(text, 0, BigInt(index))).toBe(point);
        });
        expect(() => textAt(text, -1n)).toThrow('text index out of bounds');
        for (const index of [BigInt(points.length), 9007199254740993n]) {
            expect(() => textAt(text, index)).toThrow(MissingValueError);
            expect(() => textAt(text, index)).toThrow(`text index out of bounds: ${index}`);
        }
        expect(() => selectAxis(text, 0, -1n)).toThrow('array index must be nonnegative on axis 0');
        expect(() => selectAxis(text, 0, BigInt(points.length))).toThrow('array index out of bounds on axis 0');
    });

    for (const compiled of [false, true]) {
        const runtime = () => new Interpreter(() => {}, { integerLoopCompilation: compiled, scalarEntryCompilation: false });
        it(`keeps text reads current when the loop changes its source (compiled=${compiled})`, () => {
            const r = runtime();
            try {
                expect(r.execute(`Text = "12"
Out = ""
Size = 0
for I in 0 till 3
  Out += Text 0
  Size += Text len
  Text = "😀" + Text
end
Out + (Size text)`)).toBe('1😀😀9');
            } finally { r.dispose(); }
        });

        it(`passes Euler 316 checkpoints (compiled=${compiled})`, () => {
            const r = runtime();
            try {
                const source = readFileSync(new URL('../../../demos/euler/316_decimals.ra', import.meta.url), 'utf8');
                r.execute(source.replace('option Top integer = 999999', 'Top = 999')
                    .replace('option Num integer = 10000000000000000', 'Num = 1000000'));
                expect(r.variables.get('Answer')).toBe(27280188n);
                expect(r.execute('535 waiting')).toBe(1008n);
                expect(r.execute('1111 waiting')).toBe(11107n);
            } finally { r.dispose(); }
        });
    }
});
