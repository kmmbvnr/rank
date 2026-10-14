import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue, isRankArray, type RankValue } from '../src/index.js';

const demo = readFileSync(new URL('../../../demos/dyalog/2011/003_image.ra', import.meta.url), 'utf8');
const cells = (value: RankValue): number[] => {
    expect(isRankArray(value)).toBe(true);
    if (!isRankArray(value)) throw new Error('expected array');
    return Array.from({ length: value.shape.reduce((a, b) => a * b, 1) },
        (_, i) => Number(value.itemAt?.(i) ?? value.items[i]));
};

for (const compiled of [false, true]) describe(`image helpers (compiled=${compiled})`, () => {
    const runtime = () => {
        const r = new Interpreter(undefined, { scalarCompilation: compiled, scalarFunctionCompilation: compiled,
            integerLoopCompilation: compiled, tensorCellCompilation: compiled });
        r.execute(demo);
        return r;
    };
    it('matches the contest grayscale examples and nearest-even quantization', () => {
        const r = runtime();
        expect(cells(r.execute('(array 0 16711680 65280 16777215) toGray')!)).toEqual([0, 1 / 3, 1 / 3, 1]);
        expect(formatValue(r.execute('(array 0.0 (1.0 / 3) 1.0) toRGB')!)).toBe('0 5592405 16777215');
        expect(formatValue(r.execute('((array 0.5 1.5 2.5 254.5) / 255.0) toRGB')!))
            .toBe('0 131586 131586 16711422');
        expect(formatValue(r.execute('(array 0 255 65280 16711680 shape 2 2) toGray shape')!)).toBe('2 2');
        expect(formatValue(r.execute('(array 0.0 0.5 0.75 1.0 shape 2 2) toRGB shape')!)).toBe('2 2');
        expect(formatValue(r.execute('(array shape 0 2 fill 0.0) toRGB shape')!)).toBe('0 2');
        r.dispose();
    });
    it('replicates rows then columns, keeps zero axes, and rejects negative factors', () => {
        const r = runtime();
        r.execute('Image = array 1 2 3 4 5 6 7 8 9 shape 3 3');
        const out = r.execute('(array 2 3) Image scale')!;
        expect(cells(out)).toEqual([1,1,1,2,2,2,3,3,3, 1,1,1,2,2,2,3,3,3,
            4,4,4,5,5,5,6,6,6, 4,4,4,5,5,5,6,6,6, 7,7,7,8,8,8,9,9,9, 7,7,7,8,8,8,9,9,9]);
        expect(isRankArray(out) && out.shape).toEqual([6, 9]);
        expect(formatValue(r.execute('(array 0 3) Image scale shape')!)).toBe('0 9');
        expect(formatValue(r.execute('(array 2 0) Image scale shape')!)).toBe('6 0');
        expect(() => r.execute('(array -1 2) Image scale')).toThrow(/DomainError/);
        r.dispose();
    });
    it('matches the published emboss example including wrapped borders', () => {
        const r = runtime();
        r.execute(`Kernel = array -2 -1 0 -1 1 1 0 1 2 shape 3 3
Image = array shape 5 5
1.0 1.0 1.0 1.0 1.0
0.4522875817 0.4993464052 0.4784313725 0.4575163399 0.5045751634
0.5267973856 0.9385620915 0.968627451 0.9529411765 0.9869281046
0.4522875817 0.9869281046 0.9960784314 0.9934640523 0.9934640523
0.4718954248 0.9843137255 0.9633986928 0.9947712418 0.9895424837
end`);
        const expected = [0,0.5281045752,0,0,0, 0,0.4013071895,0.3111111111,0.4104575163,0,
            1,1,1,1,1, 0.385620915,1,1,1,0, 1,1,1,1,0.4862745098];
        cells(r.execute('Kernel Image convolve')!).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 8));
        expect(() => r.execute('(array shape 2 2 fill 1) Image convolve')).toThrow(/DimensionMismatch/);
        r.dispose();
    });
    it('normalizes positive sums, uses one for nonpositive sums and clamps', () => {
        const r = runtime();
        r.execute('Image = array 0.0 0.25 0.75 1.0 shape 2 2');
        expect(cells(r.execute('(array 5 shape 1 1) Image convolve')!)).toEqual([0,0.25,0.75,1]);
        expect(cells(r.execute('(array -1 shape 1 1) Image convolve')!)).toEqual([0,0,0,0]);
        expect(cells(r.execute('(array 0 0 0 -2 2 0 0 0 0 shape 3 3) Image convolve')!)).toEqual([0,0.5,0,0.5]);
        r.dispose();
    });
    it('convolves RGB channels independently against a separate pixel reference', () => {
        const r = runtime();
        const pixels = [0xff0000, 0x00ff00, 0x0000ff, 0x123456, 0xffffff, 0];
        const kernel = [0,1,0,1,-4,1,0,1,0];
        const expected = pixels.map((_, index) => {
            let pixel = 0;
            for (const shift of [16,8,0]) {
                let sum = 0;
                for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
                    const row = (Math.floor(index / 3) + y - 1 + 2) % 2;
                    const col = (index % 3 + x - 1 + 3) % 3;
                    sum += ((pixels[row * 3 + col] >> shift) & 255) * kernel[y * 3 + x];
                }
                pixel += Math.min(255, Math.max(0, sum)) * 2 ** shift;
            }
            return pixel;
        });
        r.execute(`Image = array ${pixels.join(' ')} shape 2 3\nKernel = array ${kernel.join(' ')} shape 3 3`);
        expect(cells(r.execute('Kernel Image convolveRGB')!)).toEqual(expected);
        expect(formatValue(r.execute('Kernel Image convolveRGB shape')!)).toBe('2 3');
        r.dispose();
    });
    it('builds positive symmetric Gaussian kernels with radius ceil(3 sigma) and unit sum', () => {
        const r = runtime();
        for (const sigma of [0.2, 1, 1.1, 2]) {
            const kernel = r.execute(`${sigma} gaussianMat`)!;
            const values = cells(kernel);
            const side = 2 * Math.ceil(3 * sigma) + 1;
            expect(isRankArray(kernel) && kernel.shape).toEqual([side,side]);
            expect(values.reduce((a,b) => a+b, 0)).toBeCloseTo(1, 13);
            const radius = (side - 1) / 2;
            const sampled = values.map((_, i) => Math.exp(-((Math.floor(i / side) - radius) ** 2
                + (i % side - radius) ** 2) / (2 * sigma ** 2)));
            const total = sampled.reduce((a, b) => a + b, 0);
            values.forEach((v, i) => expect(v).toBeCloseTo(sampled[i] / total, 14));
            values.forEach((v,i) => { expect(v).toBeGreaterThan(0); expect(v).toBeCloseTo(values[values.length - 1 - i], 14); });
            if (sigma === 1) expect(values[24]).toBeCloseTo(0.15915, 3);
        }
        expect(() => r.execute('0 gaussianMat')).toThrow(/DomainError/);
        r.dispose();
    });
});
