import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Interpreter, parse } from '../src/index.js';

const source = readFileSync(new URL('../../../demos/euler/361_thuemorse.ra', import.meta.url), 'utf8');
const program = parse(source);
const helpers = { ...program, statements: program.statements.filter(statement =>
    statement.$type === 'UseStatement' || statement.$type === 'FunctionStatement') };

// Enumerate actual factors of a finite Thue-Morse word, independently of the
// demo's count recurrence and lazy node transformations.
let text = '0';
for (let i = 0; i < 12; i++) text = [...text].map(bit => bit === '0' ? '01' : '10').join('');
function factors(length: number): string[] {
    return [...new Set(Array.from({ length: text.length - length + 1 }, (_, i) => text.slice(i, i + length))
        .filter(word => word[0] === '1'))].sort();
}

describe.each([true, false])('Euler 361 scalar memoization (compilation=%s)', compilation => {
    it('completes the published Power=18 input', () => {
        const output: string[] = [];
        const runtime = new Interpreter(line => output.push(line), { compilation });
        try {
            runtime.execute(source);
            expect(output).toEqual(['178476944']);
        } finally { runtime.dispose(); }
    });

    it('matches enumerated factor counts, length boundaries and word values', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.executeProgram(helpers, []);
            runtime.execute(`
fun Len value R
  Ns = new queue
  F = new index
  J = new index
  W = new index
  Y = new index
  Z = new index
  P = new index
  Id = Ns Len R 1 word
  return Ns F J W Y Z P Id 0 (10 ** 20) eval
end
`);
            let before = 0;
            for (let length = 1; length <= 40; length++) {
                const words = factors(length);
                expect(runtime.execute(`${length} count`)).toBe(BigInt(words.length));
                expect(runtime.execute(`${length} prefix`)).toBe(BigInt(before + words.length));
                expect(runtime.execute(`${before + 1} length`)).toBe(BigInt(length));
                expect(runtime.execute(`${before + words.length} length`)).toBe(BigInt(length));
                if (length <= 16) {
                    for (const rank of new Set([0, Math.floor(words.length / 2), words.length - 1])) {
                        expect(runtime.execute(`${length} value ${rank}`)).toBe(BigInt('0b' + words[rank]));
                    }
                }
                before += words.length;
            }
        } finally { runtime.dispose(); }
    });
});
