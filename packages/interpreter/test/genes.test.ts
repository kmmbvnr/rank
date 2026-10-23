import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, isRankArray, type RankValue } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/dyalog/2011/004_genes.ra', import.meta.url), 'utf8');
const alphabet = 'ACGT';
const values = (value: RankValue) => {
    if (!isRankArray(value)) throw new Error('expected array');
    return Array.from({ length: value.shape.reduce((a, b) => a * b, 1) },
        (_, i) => value.itemAt?.(i) ?? value.items[i]);
};
const train = ['TCGTGAGAAACGAGAC', 'ATGTGAGAAACCGAGT', 'GCGTGGGAACCGAGCT', 'TCGTGGGAACCCCGGA',
    'GTGTGAGAAACTTACT', 'CTGTGGGAACTGGTAG', 'GTGTGGGAAACTACAA', 'CTGTGGGAACATTGCT',
    'CTGTGGGAACGGAAAG', 'TCGTGGGAAACACTTT'];

for (const compiled of [false, true]) describe(`Genes composition (compiled=${compiled})`, () => {
    const runtime = () => {
        const r = new Interpreter(() => {}, { scalarCompilation: compiled, scalarFunctionCompilation: compiled,
            integerLoopCompilation: compiled, tensorCellCompilation: compiled });
        r.execute(source);
        return r;
    };
    it('matches independent frequency, probability and sliding score references', () => {
        const r = runtime();
        expect(values(r.variables.get('Train')!)).toEqual(train.flatMap(row => [...row]));
        const frequency = [...alphabet].flatMap(base => Array.from({ length: 16 }, (_, col) =>
            train.filter(row => row[col] === base).length));
        expect(values(r.variables.get('F')!).map(Number)).toEqual(frequency);
        const pwm = frequency.map(count => Math.log((count + 1) / 14));
        values(r.variables.get('PWM')!).map(Number).forEach((v, i) => expect(v).toBeCloseTo(pwm[i], 14));
        const sequence = 'CCATCGTGGGAAACACTTTCGAA';
        const scores = Array.from({ length: sequence.length - 16 + 1 }, (_, offset) => {
            let total = 0;
            for (let col = 0; col < 16; col++) total += pwm[alphabet.indexOf(sequence[offset + col]) * 16 + col];
            return total;
        });
        values(r.variables.get('Scores')!).map(Number).forEach((v, i) => expect(v).toBeCloseTo(scores[i], 13));
        const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
        expect(order.slice(0, 5)).toEqual([3, 5, 2, 4, 6]);
        expect(values(r.variables.get('Best')!)).toEqual(order.slice(0, 5).flatMap(i => [...sequence.slice(i, i + 16)]));
        for (const [name, shape] of [['F', [4, 16]], ['PWM', [4, 16]], ['Scores', [8]], ['Best', [5, 16]]] as const) {
            const value = r.variables.get(name)!;
            expect(isRankArray(value) && value.shape).toEqual(shape);
        }
        r.dispose();
    });
    it('uses the correct nucleotide and position for small arbitrary motifs', () => {
        const r = runtime();
        for (const width of [1, 2, 3, 5]) {
            const weights = Array.from({ length: 4 * width }, (_, i) => -0.17 * (i + 1) ** 2);
            const sequence = 'TAGCACGTATGC';
            r.execute(`Weights = array ${weights.map(value => value.toFixed(12)).join(' ')} shape 4 ${width}`);
            const expected = Array.from({ length: sequence.length - width + 1 }, (_, start) => {
                let sum = 0;
                for (let col = 0; col < width; col++) sum += weights[alphabet.indexOf(sequence[start + col]) * width + col];
                return sum;
            });
            const actual = values(r.execute(`Weights score "${sequence}"`)!);
            expect(actual).toHaveLength(expected.length);
            actual.forEach((v, i) => expect(Number(v)).toBeCloseTo(expected[i], 12));
        }
        r.dispose();
    });
    it('retains the first five positions for tied scores, including duplicate strings', () => {
        const r = runtime();
        r.execute('Weights = array shape 4 2 fill 0.0');
        expect(values(r.execute('Weights top5 "ACGTACGT"')!)).toEqual([...'ACCGGTTAAC']);
        expect(values(r.execute('Weights top5 "AAAAAA"')!)).toEqual(Array(10).fill('A'));
        r.dispose();
    });
});
