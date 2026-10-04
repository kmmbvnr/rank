import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { functionTestExamples } from '../src/analysis/test-examples.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const project = 'fun project Start Finish Reward\n return record\n  .start = Start\n  .finish = Finish\n'
    + '  .reward = Reward\n end\nend\n';

/** Facts for `f` called with a queue that the test filled from the given push lines. */
function result(body: string, pushes: string[], extra = '') {
    const module = parser.parse<Program>(`${project}${extra}fun f Jobs\n${body}\nend\n`);
    expect(module.parserErrors).toEqual([]);
    const test = parser.parse<Program>('test "t"\n use "m"\n Jobs = new queue\n'
        + pushes.map(line => ` Jobs push ${line}\n`).join('') + ' Jobs f equal 0\nend\n');
    expect(test.parserErrors).toEqual([]);
    const examples = functionTestExamples(test.value, 'm', new Set(['project', 'f', 'mixed']));
    expect(examples).toHaveLength(1);
    const analysis = analyzeValues(module.value, new Map(), new Map(), examples);
    expect(analysis.diagnostics).toEqual([]);
    return analysis.functionResults[0];
}
const jobs = ['2 4 4 project', '3 6 6 project'];
const first = ' Sorted = Jobs sort by .finish .start\n';

describe('records pushed by module functions through a sorted queue', () => {
    it('keeps the integer field through sorting, indexing and indexed iteration', () => {
        expect(result(`${first} Item = Sorted 0\n return Item .reward`, jobs).types).toEqual(['integer']);
        expect(result(`${first} for Project i in Sorted\n  return Project .finish\n end\n return 0`, jobs).types)
            .toEqual(['integer']);
    });

    it('keeps the field of a queue that is iterated without sorting', () => {
        expect(result(' for Project in Jobs\n  return Project .reward\n end\n return 0', jobs).types)
            .toEqual(['integer']);
    });

    it('carries numeric cells through the dynamic-programming writes and the indexed return', () => {
        const body = `${first} Count = Sorted len\n Best = array shape (Count + 1) fill 0\n`
            + ' for Project i in Sorted\n  Skip = Best i\n  Take = Best i + Project .reward\n'
            + '  Best (i + 1) = Skip Take max\n end\n return Best Count';
        expect(result(body, jobs).types).toEqual(['integer']);
    });

    it('does not assume that a reward is an integer when a push builds it from a real', () => {
        const types = result(`${first} Item = Sorted 0\n return Item .reward`,
            ['2 4 4 project', '3 6 1.5 project']).types;
        expect(types).toContain('real');
    });
});

describe('claims the sorted record path must not make', () => {
    it('names no field that the records do not share', () => {
        expect(result(`${first} Item = Sorted 0\n return Item .missing`, jobs).types).toEqual([]);
        expect(result(' Sorted = Jobs sort by .missing\n Item = Sorted 0\n return Item .reward', jobs).types)
            .toEqual([]);
    });

    it('claims nothing when the test did not build the queue from module calls', () => {
        expect(result(`${first} Item = Sorted 0\n return Item .reward`, ['2 4 4 project', '5']).types)
            .toEqual([]);
        expect(result(`${first} Item = Sorted 0\n return Item .reward`, ['2 4 4 unknown']).types).toEqual([]);
    });

    it('claims nothing for a field of a record whose schema the pushes do not agree on', () => {
        const mixed = 'fun mixed\n return record\n  .other = 1\n end\nend\n';
        expect(result(`${first} Item = Sorted 0\n return Item .reward`, ['2 4 4 project', 'mixed'], mixed).types)
            .toEqual([]);
    });

    it('drops the schema once a scalar is written over a cell', () => {
        expect(result(`${first} Sorted 0 = 1\n Item = Sorted 0\n return Item .reward`, jobs).types).toEqual([]);
    });

    it('drops the schema when the loop inserts another record shape', () => {
        const body = ' for Project in Jobs\n  Jobs push record\n   .reward = "text"\n  end\n  Last = Project .reward\n end\n'
            + ' return Last';
        expect(result(body, jobs).types).not.toEqual(['integer']);
    });

    it('drops the schema after an insertion the function makes itself', () => {
        const body = ' Jobs push record\n  .reward = "text"\n end\n Top = Jobs peek\n return Top .reward';
        expect(result(body, jobs).types).not.toEqual(['integer']);
    });
});

describe('test examples that fill a collection', () => {
    const examples = (lines: string) => {
        const parsed = parser.parse<Program>(`test "t"\n use "m"\n${lines}\nend\n`);
        expect(parsed.parserErrors).toEqual([]);
        return functionTestExamples(parsed.value, 'm', new Set(['project', 'f']));
    };

    it('records the pushed calls in order for the collection argument', () => {
        const [example] = examples(' Jobs = new queue\n Jobs push 1 2 3 project\n Jobs push 4 5 6 project\n Jobs f equal 0');
        expect(example.constructions?.[0]?.map(site => site.name)).toEqual(['project', 'project']);
    });

    it('forgets the construction when the collection is aliased or used by another statement', () => {
        expect(examples(' Jobs = new queue\n Other = Jobs\n Jobs push 1 2 3 project\n Jobs f equal 0')[0]
            .constructions).toBeUndefined();
        expect(examples(' Jobs = new queue\n Jobs push 1 2 3 project\n Jobs pop\n Jobs f equal 0')[0]
            .constructions).toBeUndefined();
        expect(examples(' Jobs = new queue\n Jobs push 7\n Jobs f equal 0')[0].constructions).toBeUndefined();
    });
});
