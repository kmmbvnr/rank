import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { answerOf } from './support.js';
const source = readFileSync(new URL('../../../demos/euler/740_secretsanta.ra', import.meta.url), 'utf8');

// Label every name and enumerate both allowed draws in their actual order.
// This uses no compressed categories, pair tensors or continuation tables.
function direct(people: number): number {
    const counts = Array<number>(people).fill(2), memo = new Map<string, number>();
    function visit(person: number): number {
        if (person === people - 1) return counts[person] > 0 ? 1 : 0;
        const key = `${person}:${counts.join('')}`, known = memo.get(key);
        if (known !== undefined) return known;
        const allowed = counts.reduce((a, b) => a + b, 0) - counts[person];
        let answer = 0;
        for (let first = 0; first < people; first++) {
            if (first === person || !counts[first]) continue;
            const chance = counts[first] / allowed;
            counts[first]--;
            for (let second = 0; second < people; second++) {
                if (second === person || !counts[second]) continue;
                const next = counts[second] / (allowed - 1);
                counts[second]--;
                answer += chance * next * visit(person + 1);
                counts[second]++;
            }
            counts[first]++;
        }
        memo.set(key, answer);
        return answer;
    }
    return visit(0);
}
for (const compilation of [false, true]) describe(`Euler 740 (compiled=${compilation})`, () => {
    it.each([1, 2, 3, 4, 5, 6, 7, 8])('matches labelled-slip enumeration for People=%i', people => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(source.replace('arg People integer = 100', `People = ${people}`));
            const expected = direct(people);
            expect(answerOf(runtime)).toBe(expected.toFixed(10));
            expect(runtime.execute('Table Start')).toBeCloseTo(expected, 13);
            if (people === 3) expect(expected.toFixed(10)).toBe('0.3611111111');
            if (people === 5) expect(expected.toFixed(10)).toBe('0.2476095994');
        } finally { runtime.dispose(); }
    });
});
