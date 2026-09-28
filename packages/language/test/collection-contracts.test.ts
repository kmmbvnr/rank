import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { type Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { type ValueFacts } from '../src/analysis/value-domain.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function analyze(source: string, initial = new Map<string, ValueFacts>()) {
    const parsed = parser.parse<Program>('use algo\nuse sequences\n' + source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    return analyzeValues(parsed.value, initial);
}
const messages = (source: string) => analyze(source).diagnostics.map(item => item.message);

describe('collection contracts in value analysis', () => {
    for (const kind of ['set', 'counter', 'queue', 'stack', 'deque', 'heap']) {
        const insert = (receiver: string, value: string) => kind === 'heap' ? `${receiver} 0 (${value}) enqueue`
            : `${receiver} ${['set', 'counter'].includes(kind) ? 'add' : 'push'} ${value}`;
        const remove = ['set', 'counter'].includes(kind) ? 'C remove array 1 2' : 'Removed = C pop';

        it(`${kind}: follows aliases and retains array cells after removal`, () => {
            expect(messages(`C = new ${kind}\nAlias = C\n${insert('Alias', 'array 1 2')}\n${remove}\n${insert('C', 'array "bad"')}`))
                .toEqual(['C holds array of integer and cannot receive array of text']);
        });

        it(`${kind}: ignores lengths and distinguishes numeric cell types`, () => {
            expect(messages(`C = new ${kind}\n${insert('C', 'array 1 2')}\n${insert('C', 'array 3 4 5')}`))
                .toEqual([]);
            expect(messages(`C = new ${kind}\n${insert('C', 'array 1 2')}\n${insert('C', 'array 3.0')}`))
                .toEqual(['C holds array of integer and cannot receive array of real']);
        });

        it(`${kind}: checks known loop insertions against the established contract`, () => {
            expect(messages(`C = new ${kind}\n${insert('C', '1')}\nfor Value in array "bad"\n ${insert('C', 'Value')}\nend`))
                .toContain('C holds integer and cannot receive text');
        });
    }

    it('checks both deque ends and propagates array facts through reads', () => {
        expect(messages('D = new deque\nD (array 1 2) pushfront\nD (array "bad") pushback'))
            .toEqual(['D holds array of integer and cannot receive array of text']);
        for (const read of ['Q peek', 'Q pop', 'Q 0']) {
            expect(analyze(`Q = new queue\nQ push array 1 2\nA = ${read}`).bindings.get('A'))
                .toMatchObject({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
        }
    });

    it('propagates array cells into an iteration without freezing lengths', () => {
        const analysis = analyze('Q = new queue\nQ push array 1 2\nfor A in Q\n B = A\nend');
        const a = [...analysis.expressions].find(([node]) => node.$type === 'NameExpression' && 'name' in node && node.name === 'A');
        expect(a?.[1]).toMatchObject({ types: ['array'], rank: 1, shape: [null], elements: ['integer'] });
    });

    it('drops alias identities when a branch may rebind an alias', () => {
        expect(messages(`Q = new queue
Alias = Q
if Unknown
 Alias = new queue
end
Alias push 1
Q push "text"
`)).toEqual([]);
    });

    it('does not invent facts for external collections or unknown effects', () => {
        const external = analyze('Q push 1\nA = Q pop', new Map([['Q', { types: ['queue'] }]]));
        expect(external.bindings.get('A')?.types).toEqual([]);
        expect(messages('Q = new queue\nQ push 1\nQ external\nQ push "text"')).toEqual([]);
        const lazy = analyze('Q = new queue\nQ push A\nB = Q pop', new Map([['A', { types: ['array'], rank: 1 }]]));
        expect(lazy.bindings.get('B')?.types).toEqual([]);
    });

    it('retains array rank while deferring the cell type of an empty array', () => {
        expect(messages('Q = new queue\nQ push array shape 0 fill 0\nQ push array "text"')).toEqual([]);
    });

    it('does not narrow previously unknown or possibly empty array cells', () => {
        for (const initial of [
            { types: ['array'], rank: 1, shape: [null], elements: ['integer'], callbackFreeScalarCells: true },
            { types: ['array'], rank: 1, shape: [1], callbackFreeScalarCells: true },
        ] satisfies ValueFacts[]) {
            const result = analyze('Q = new queue\nQ push A\nQ push array 1\nB = Q pop', new Map([['A', initial]]));
            expect(result.bindings.get('B')?.elements).toBeUndefined();
        }
    });
});
