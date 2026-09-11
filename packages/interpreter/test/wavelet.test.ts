import { describe, expect, it } from 'vitest';
import { RankWavelet } from '../src/wavelet.js';
import { run } from './support.js';

describe('wavelet matrix', () => {
    it('counts an inclusive index and value rectangle', () => {
        expect(run([
            'use algo',
            'Data = (array 3 2 4 5 1 1 5 3) wavelet',
            'A = Data 1 3 2 4 within',
            'B = Data 4 5 2 9 within',
            'C = Data 0 7 1 5 within',
            'array A B C',
        ].join('\n'))).toBe('2 0 8');
    });

    it('supports duplicate text and absent bounds', () => {
        expect(run([
            'use algo',
            'Data = (array "b" "a" "b" "d") wavelet',
            'Result = array shape 2',
            '  (Data 0 3 "b" "c" within)',
            '  (Data 1 2 "x" "z" within)',
            'end',
            'Result',
        ].join('\n'))).toBe('2 0');
    });

    it('sums an inclusive numeric rectangle', () => {
        expect(run([
            'use algo',
            'Data = (array 3 2 4 5 1 1 5 3) wavelet',
            'A = Data 1 3 2 4 sumwithin',
            'B = Data 4 5 2 9 sumwithin',
            'C = Data 0 7 1 5 sumwithin',
            'array A B C',
        ].join('\n'))).toBe('6 0 24');
    });

    it('finds the first missing coin sum', () => {
        expect(run([
            'use algo',
            'Data = (array 2 9 1 2 7) wavelet',
            'Bounds = array shape 3 2',
            '  1 3',
            '  3 3',
            '  0 4',
            'end',
            'Data Bounds missing',
        ].join('\n'))).toBe('4 1 6');
    });

    it('exposes type, length and shape', () => {
        expect(run([
            'use algo',
            'use sequences',
            'Data = (array 1 2 3) wavelet',
            'array (Data type) (Data len) (Data shape)',
        ].join('\n'))).toBe('.wavelet 3 3');
    });

    it('reports invalid ranges and input', () => {
        expect(() => run([
            'use algo',
            'Data = (array 1 2) wavelet',
            'Data 1 0 1 2 within',
        ].join('\n'))).toThrow(
            'wavelet range start must not exceed its end',
        );
        expect(() => run('use algo\n(array 1 "a") wavelet'))
            .toThrow('wavelet values must have one comparable type');
        expect(() => run('(array 1 2) wavelet'))
            .toThrow('unknown name: wavelet');
        expect(() => run([
            'use algo',
            'Data = (array "a" "b") wavelet',
            'Data 0 1 "a" "b" sumwithin',
        ].join('\n'))).toThrow(
            'sumwithin expects numeric wavelet values',
        );
        expect(() => run([
            'use algo',
            'Data = (array 0 1 2) wavelet',
            'Data (array 0 2) missing',
        ].join('\n'))).toThrow(
            'missing expects positive integer wavelet values',
        );
    });

    it('matches a direct counting oracle', () => {
        let seed = 29;
        const random = (limit: number): number => {
            seed = (seed * 48271) % 2147483647;
            return seed % limit;
        };
        const values = Array.from(
            { length: 73 }, () => BigInt(random(20)),
        );
        const data = {
            kind: 'array' as const,
            items: values,
            shape: [values.length],
        };
        const wavelet = new RankWavelet(data);
        for (let step = 0; step < 300; step += 1) {
            const a = random(values.length);
            const b = random(values.length);
            const left = Math.min(a, b);
            const right = Math.max(a, b);
            const c = random(25);
            const d = random(25);
            const low = Math.min(c, d);
            const high = Math.max(c, d);
            const expected = values.slice(left, right + 1)
                .filter(value => value >= BigInt(low)
                    && value <= BigInt(high))
                .length;
            expect(wavelet.count(
                BigInt(left), BigInt(right),
                BigInt(low), BigInt(high),
            )).toBe(BigInt(expected));
            const sum = values.slice(left, right + 1)
                .filter(value => value >= BigInt(low)
                    && value <= BigInt(high))
                .reduce((total, value) => total + value, 0n);
            expect(wavelet.sum(
                BigInt(left), BigInt(right),
                BigInt(low), BigInt(high),
            )).toBe(sum);
        }
    });

    it('matches a direct missing-sum oracle', () => {
        const values = [4n, 1n, 2n, 2n, 9n, 1n];
        const data = {
            kind: 'array' as const,
            items: values,
            shape: [values.length],
        };
        const wavelet = new RankWavelet(data);
        for (let left = 0; left < values.length; left += 1) {
            for (let right = left; right < values.length; right += 1) {
                let expected = 1n;
                const coins = values.slice(left, right + 1)
                    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
                for (const value of coins) {
                    if (value > expected) break;
                    expected += value;
                }
                expect(wavelet.missing(BigInt(left), BigInt(right)))
                    .toBe(expected);
            }
        }
    });
});
