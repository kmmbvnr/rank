import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import type { Program } from '../src/generated/ast.js';
import { createRankServices } from '../src/rank-module.js';

const services = createRankServices(EmptyFileSystem);
function analyze(source: string) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    return analyzeValues(parsed.value);
}

it('groups comparison rank before conversion and preserves Unicode frame shape', () => {
    const result = analyze(`use sequences
Text = "(😀é)"
Open = Text "(" equal rank 0
Ints = Text "(" equal rank 0 integer
Delta = Ints - (Text ")" equal rank 0 integer)
Depth = Delta scan +
Good = (Depth at least 0) all
Total = Delta sum
Empty = "" "(" equal rank 0 integer
Whole = "1203" integer
Digits = "1203" integer rank 0`);
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.get('Open')).toMatchObject({ types: ['array'], shape: [5], elements: ['boolean'] });
    expect(result.bindings.get('Ints')).toMatchObject({ types: ['array'], shape: [5], elements: ['integer'] });
    expect(result.bindings.get('Empty')).toMatchObject({ types: ['array'], shape: [0], elements: ['integer'] });
    expect(result.bindings.get('Whole')).toMatchObject({ types: ['integer'] });
    expect(result.bindings.get('Digits')).toMatchObject({ types: ['array'], shape: [4], elements: ['integer'] });
});

it('casts boolean tensors with their original shape', () => {
    const result = analyze('use sequences\nMask = array shape 2 3 fill false\nInts = Mask integer');
    expect(result.diagnostics).toEqual([]);
    expect(result.bindings.get('Ints')).toMatchObject({ types: ['array'], shape: [2, 3], elements: ['integer'] });
});
