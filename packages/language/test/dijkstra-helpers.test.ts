import { readFileSync } from 'node:fs';
import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import { isFunctionStatement, type Program } from '../src/generated/ast.js';
import { functionTestExamples } from '../src/analysis/test-examples.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const demo = new URL('../../../demos/cses/graph/011_discount', import.meta.url);

function parse(path: URL | string) {
    const parsed = parser.parse<Program>(readFileSync(path, 'utf8'));
    expect(parsed.parserErrors).toEqual([]);
    return parsed.value;
}

describe('numeric results through Dijkstra helpers and heap payloads (flight_discount)', () => {
    const program = parse(`${demo.pathname}.ra`);
    const names = new Set(program.statements.filter(isFunctionStatement).map(statement => statement.name));
    const examples = functionTestExamples(parse(`${demo.pathname}_test.ra`), '011_discount', names)
        .filter(example => example.name === 'flight_discount');

    it('finds the four demo examples', () => {
        expect(examples.map(example => example.test)).toEqual([
            'official example', 'discounts an expensive edge',
            'uses one coupon on a longer path', 'keeps large integer prices exact',
        ]);
    });

    it('infers an integer result for every example without a real or infinity claim', () => {
        const { functionResults } = analyzeValues(program, new Map(), new Map(), examples);
        expect(functionResults).toHaveLength(examples.length);
        // Compare only the summary: a failing diff of the whole fact object exhausts the heap.
        for (const { types, rank, shape } of functionResults) expect({ types, rank, shape }).toEqual({ types: ['integer'], rank: 0, shape: [] });
    });

    it('reports no diagnostics for the demo', () => {
        expect(analyzeValues(program, new Map(), new Map(), examples).diagnostics.map(item => item.message)).toEqual([]);
    });
});
