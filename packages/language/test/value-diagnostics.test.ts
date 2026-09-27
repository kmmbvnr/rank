import { EmptyFileSystem } from 'langium';
import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { functionTestExamples } from '../src/analysis/test-examples.js';

let services: ReturnType<typeof createRankServices>;
beforeAll(() => { services = createRankServices(EmptyFileSystem); });
function messages(source: string): string[] {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    return analyzeValues(parsed.value).diagnostics.map(item => item.message);
}

it('reports an incompatible reassignment before execution', () => {
    expect(messages('Count = 1\nCount = "x"')).toEqual(['Count has type integer and cannot receive text']);
    expect(messages('Count = 1\nCount /= 2')).toEqual(['Count has type integer and cannot receive real']);
});

it('reports incompatible scalar operands', () => {
    expect(messages('Count = 1\nCount + "x"')).toEqual(['operator + does not accept integer and text']);
    expect(messages('"a" + "b"')).toEqual([]);
    expect(messages('Unknown + "b"')).toEqual([]);
});

it('checks known shapes using singleton broadcasting', () => {
    expect(messages('A = array shape 2 3 fill 0\nB = array shape 2 4 fill 0\nA + B'))
        .toEqual(['shape mismatch: [2, 3] and [2, 4]']);
    expect(messages('A = array shape 2 3 fill 0\nB = array shape 1 3 fill 0\nA + B')).toEqual([]);
});

it('does not freeze elastic dimensions or require known external values', () => {
    expect(messages('A = array 1 2\nA = array 1 2 3')).toEqual([]);
    expect(messages('A = array shape N 3 fill 0\nB = array shape 4 3 fill 0\nA + B')).toEqual([]);
});

it('keeps the first array rank across assignments and unknown calls', () => {
    for (const replacement of ['array 2 2 2 2 shape 2 2', 'array shape 2 2\n 2 2\n 2 2\nend',
        'array shape N 2 fill 0', 'array shape 0 2 fill 0']) {
        expect(messages(`A = array 1 2 3\nA = ${replacement}`))
            .toEqual(['A has rank 1 and cannot receive rank 2']);
    }
    expect(messages('A = array 1 2\nA = 0 external\nA = array shape 2 2 fill 0'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
    expect(messages('A = array shape 2 2 fill 0\nA = array shape 3 4 fill 0')).toEqual([]);
    expect(messages('A = array 1 2\nA += array shape 2 2 fill 0'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
});

it('checks inline array element counts without executing dimensions', () => {
    expect(messages('M = array 1 2 3 shape 2 2')).toEqual(['array shape 2 2 expects 4 elements, got 3']);
    expect(messages('M = array 1 2 3 4 shape 2 2')).toEqual([]);
    expect(messages('M = array 1 2 shape N 2')).toEqual([]);
});

it('keeps slice result types during program analysis', () => {
    expect(messages('A = (1 to 5) from 1 until 3\nA = "text"'))
        .toEqual(['A has type array and cannot receive text']);
    expect(messages('T = "A😀БC" from 1 until 3\nT = array 1 2'))
        .toEqual(['T has type text and cannot receive array']);
    expect(messages('Q = new queue\nA = Q from 0 until 0\nA = "text"'))
        .toEqual(['A has type array and cannot receive text']);
});

it('infers safe unpacked shape cells without losing unrelated types', () => {
    expect(messages('M = array shape 2 3 fill 0\nunpack Rows Cols = M shape\nRows + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Count = 1\nM = array shape 2 3 fill 0\nunpack Rows Cols = M shape\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Count = 1\nA = array Unknown Unknown\nunpack First Second = A\nCount + "bad"'))
        .toEqual([]);
    expect(messages('Count = 1\nfor I in 0 until 1\n unpack First Second = array 2 3\nend\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('First = true\nunpack First Second = array 2 3'))
        .toEqual(['First has type boolean and cannot receive integer']);
    expect(messages('M = array shape N fill 0\nunpack First Second = M\nFirst + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('infers each type from a fixed mixed array and a parse pattern', () => {
    expect(messages('Values = array 1 "two"\nunpack Number Text = Values\nNumber + "bad"\nText + 1'))
        .toEqual(['operator + does not accept integer and text', 'operator + does not accept text and integer']);
    expect(messages('Values = array "one" "two"\nunpack First Second = Values\nFirst + 1'))
        .toEqual(['operator + does not accept text and integer']);
    expect(messages('fun pair X\n return array X "two"\nend\nValues = 1 pair\n'
        + 'unpack Number Text = Values\nNumber + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use text\nPattern = "/integer:/word"\nValues = "42:abc" Pattern parse\n'
        + 'unpack Number Text = Values\nNumber + "bad"\nText + 1'))
        .toEqual(['operator + does not accept integer and text', 'operator + does not accept text and integer']);
    expect(messages('if Flag\n Values = array 1 "one"\nelse\n Values = array 2 "two"\nend\n'
        + 'unpack Number Text = Values\nNumber + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Values = array 1 "two"\nValues 0 = "three"\n'
        + 'unpack Number Text = Values\nNumber + "bad"')).toEqual([]);
});

it('infers mixed parse positions in the unchanged AoC snow demo', () => {
    const source = readFileSync(new URL('../../../demos/aoc/2015/025_snow.ra', import.meta.url), 'utf8');
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const result = analyzeValues(parsed.value, new Map(), new Map(), [{
        name: 'solve', arguments: [{ types: ['text'], rank: 1, shape: [null] }],
    }]);
    const capture = [...result.expressions].find(([expression]) =>
        expression.$cstNode?.text === 'Text Pattern parse')?.[1];
    expect(capture?.positions).toEqual([['text'], ['integer'], ['integer']]);
    expect(result.functionResults[0].types).toEqual(['integer']);
});

it('keeps unrelated facts through local index writes', () => {
    expect(messages('use algo\nCount = 1\nindex "x" = 2\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun read X\n Count = 1\n index X = 2\n return Count\nend\nA = 0 read\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun read X\n Count = 1\n for I in 0 until 1\n  index I = 2\n end\n return Count\nend\nA = 0 read\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\nA = Unknown\nindex (A 0) = 2\nCount + "bad"'))
        .toEqual([]);
});

it('keeps unrelated facts through scalar set additions but not lazy array keys', () => {
    expect(messages('use algo\nCount = 1\nset add "x"\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun read X\n Count = 1\n for I in 0 until 1\n  counter add "x"\n end\n return Count\nend\nA = 0 read\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\nset add (array Unknown Unknown)\nCount + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nCount = 1\nA = Unknown\nset add (A 0)\nCount + "bad"'))
        .toEqual([]);
});

it('keeps unrelated facts through direct queue pushes but not computed receivers', () => {
    expect(messages('use algo\nCount = 1\nQ = new queue\nQ push 2\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun append X\n Count = 1\n Q = new queue\n for I in 0 until 1\n  Q push X\n end\n return Count\nend\nA = 0 append\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\nA = Unknown\n(A 0) push 2\nCount + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nCount = 1\nqueue push 2\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(
        'use algo\nfun collect X\n Q = new queue\n Q push X\n return Q\nend\nA = 0 collect\n');
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value).bindings.get('A')?.types).toEqual(['queue']);
});

it('infers indexed text loops without trusting an unknown iterator', () => {
    const reader = 'fun indexed Text\n Count = 0\n for C I in Text\n  Count += I\n end\n return Count\nend\n';
    expect(messages(reader + 'Result = "abc" indexed\nResult + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Count = 1\nfor C I in Unknown\n Count += I\nend\nCount + "bad"'))
        .toEqual([]);
    expect(messages('Count = 1\nA = Unknown\nfor Value I in (A 0) to 3\n Count += I\nend\n'
        + 'Count + "bad"')).toEqual([]);
    expect(messages('Count = 1\nA = Unknown\nfor Value I in 0 to 3 by (A 0)\n Count += I\nend\n'
        + 'Count + "bad"')).toEqual([]);
    expect(messages('Count = 1\nfor C I in ""\n Count = "bad"\nend\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('keeps types through a scalar lookup in the local index', () => {
    expect(messages('use algo\nfun read X\n Count = 1\n First = index X default -1\n return Count\nend\n'
        + 'Result = "x" read\nResult + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nCount = 1\nA = Unknown\nFirst = index (A 0) default -1\nCount + "bad"'))
        .toEqual([]);
});

it('infers value types written to a fresh function-local index', () => {
    expect(messages('use algo\nfun lookup\n index "a" = 1\n return index "a"\nend\nA = lookup\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun lookup\n index "a" = true\n return index "b" default false\nend\nA = lookup\nA + 1'))
        .toEqual(['operator + does not accept boolean and integer']);
    expect(messages('use algo\nfun lookup Key Value\n index "a" = 1\n index Key = Value\n return index "a"\nend\nA = Unknown Unknown lookup\nA + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nfun lookup Key\n index "a" = 1\n index "b" = "text"\n return index Key\nend\nA = "a" lookup\nA = true'))
        .toEqual(['A has type integer or text and cannot receive boolean']);
    expect(messages('use algo\nfun lookup\n for I in 0 to 1\n  index I = I\n end\n return index 0\nend\nA = lookup\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('use algo\nfun lookup\n index 0 = 1\n for I in 0 to 1\n  index I = "text"\n end\n return index 0\nend\nA = lookup\nA + "bad"'))
        .toEqual([]);
});

it('infers the unchanged regular-expression matcher from its local index writes', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/010_regexp.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/leetcode/010_regexp_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '010_regexp', new Set(['match']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['boolean']));
});

it('gives function locals their own rank contract', () => {
    expect(messages('A = array 1 2\nfun make N\n A = array 1 2 3 4 shape 2 2\n return A\nend\nM = 0 make')).toEqual([]);
    expect(messages('fun change A\n A = array 1 2 3 4 shape 2 2\n return A\nend\n(array 1 2) change'))
        .toEqual(['change: A has rank 1 and cannot receive rank 2']);
    expect(messages('A = array 1 2\nuse sequences\nA = array 1 2 3 4 shape 2 2'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
});

it('does not reuse dimensions across a conditional reassignment', () => {
    expect(messages('A = array 1 2\nif Flag\n A = array 1 2 3\nend\nB = array 1 2 3\nA + B')).toEqual([]);
});

it('joins new bindings from nested branches and preserves their common rank', () => {
    const body = 'if Flag\n if Other\n  M = array shape 2 3 fill 0\n else\n  M = array shape 4 3 fill 0\n end\nelse\n M = array shape 5 3 fill 0\nend\n';
    expect(messages(body + 'M # # #')).toEqual(['3 selectors exceed array rank 2']);
    expect(messages(body + 'M = array shape 7 8 fill 0')).toEqual([]);
    expect(messages(body + 'M = array 1 2')).toEqual(['M has rank 2 and cannot receive rank 1']);
    expect(messages('fun choose Flag Other\n' + body + 'return M\nend\nA = X Y choose\nA # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
    expect(messages('if Flag\n M = array shape 2 3 fill 0\nend\nM # # #')).toEqual([]);
});

it('respects ordered elif reachability and unreachable side effects', () => {
    expect(messages('if false\n A = "bad"\nelif true\n A = 1\nelse\n A = "bad"\nend\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun choose X\n if false\n  return "bad"\n elif true\n  return 1\n else\n  return "bad"\n end\nend\nA = Flag choose\nA = "bad"'))
        .toEqual(['A has type integer and cannot receive text']);
    expect(messages('A = array 1 2\nif true\n A = array 1 2 3\nelif change\n A = array 1\nend\nA + (array 1 2)'))
        .toEqual(['shape mismatch: [3] and [2]']);
});

it('checks loop binding contracts without freezing iteration dimensions', () => {
    expect(messages('A = array 1 2\nfor I in 1 to 3\n A = array shape 2 2 fill 0\nend'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
    expect(messages('Count = 1\nfor I in 1 to 3\n Count = "bad"\nend'))
        .toEqual(['Count has type integer and cannot receive text']);
    expect(messages('A = array 1 2\nfor I in 1 to 3\n A + (array 1 2 3)\n A = array 1 2 3\nend\nA + (array 1 2)'))
        .toEqual([]);
    expect(messages('A = array 1 2\nfor I in 1 to 3\n for J in 1 to 2\n A = array shape 2 2 fill 0\n end\nend'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
});

it('does not diagnose empty or unproven loops or statements after a loop exit', () => {
    for (const header of ['I in 1 until 1', 'I in Items', 'false']) {
        expect(messages(`A = 1\nfor ${header}\n A = "bad"\nend`)).toEqual([]);
    }
    expect(messages('A = array 1 2\nfor I in 1 until 1\n A = array 1 2 3\nend\nA + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages('A = 1\nfor I in 1 to 3\n break\n A = "bad"\nend')).toEqual([]);
    expect(messages('A = array 1 2\nfor I in 1 to 3\n continue\n A = array shape 2 2 fill 0\nend')).toEqual([]);
});

it('keeps loop contracts in functions and after loops while discarding mutation facts', () => {
    expect(messages('fun make X\n A = array shape 2 3 fill 0\n for I in 1 to 3\n A = array shape 4 3 fill 0\n end\n return A\nend\nM = 0 make\nM # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
    expect(messages('A = array 1 2\nfor I in Items\n A = array 1 2 3\nend\nA = array shape 2 2 fill 0'))
        .toEqual(['A has rank 1 and cannot receive rank 2']);
    expect(messages('A = array 1 2\nfor I in 1 to 3\n A 0 = "text"\n A + (array 1 2)\nend')).toEqual([]);
    expect(messages('fun choose X\n for I in 1 to 3\n  return 1\n end\n return "text"\nend\nA = 0 choose\nA = true'))
        .toEqual(['A has type integer or text and cannot receive boolean']);
});

it('checks reductions against the actual runtime rule, allowing full rank', () => {
    expect(messages('A = array shape 2 3 fill 0\nA + reduce rank 3'))
        .toEqual(['rank 3 exceeds value rank 2']);
    expect(messages('A = array shape 2 3 fill 0\nA + reduce rank 2')).toEqual([]);
});

it('checks axis bounds and selector counts', () => {
    expect(messages('A = array shape 2 3 fill 0\nA sum axis 2'))
        .toEqual(['axis 2 is invalid for rank 2']);
    expect(messages('A = array shape 2 3 fill 0\nA # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
    expect(messages('A = array shape 2 3 fill 0\nA # 0')).toEqual([]);
});

it('does not reuse shapes after a call that may change a captured binding', () => {
    expect(messages('A = array 1 2\nfun change\n A = array 1 2 3\nend\nchange\nB = array 1 2 3\nA + B')).toEqual([]);
});

it('checks nested expressions and respects text rank', () => {
    expect(messages('array (1 + "x")')).toEqual(['operator + does not accept integer and text']);
    expect(messages('"a" + "long"')).toEqual([]);
    expect(messages('"abc" + reduce rank 1')).toEqual([]);
});

it('infers a helper result from its body and literal call arguments', () => {
    expect(messages('fun addone X\n return X + 1\nend\nA = 3 addone\nA = "x"'))
        .toEqual(['A has type integer and cannot receive text']);
    expect(messages('fun matrix X\n return array shape 2 3 fill X\nend\nA = 0 matrix\nA # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
    expect(messages('fun addone X\n return X + 1\nend\nInput = 3\nA = Input addone\nA = "x"'))
        .toEqual(['A has type integer and cannot receive text']);
});

it('checks variable arguments and results through local calculations and helper calls', () => {
    const helpers = 'fun increment X\n Y = X + 1\n return Y\nend\nfun twice X\n Y = X increment\n return Y increment\nend\n';
    expect(messages(helpers + 'Input = "bad"\nInput twice'))
        .toContain('twice: increment: operator + does not accept text and integer');
    expect(messages(helpers + 'Input = 3\nResult = Input twice\nResult = "bad"'))
        .toEqual(['Result has type integer and cannot receive text']);
    expect(messages(helpers + 'Input = Unknown\nInput twice')).toEqual([]);
});

it('checks array argument shapes and preserves the rank of computed results', () => {
    const helper = 'fun combine A B\n Result = A + B\n return Result\nend\n';
    expect(messages(helper + 'A = array shape 2 3 fill 0\nB = array shape 2 4 fill 0\nA B combine'))
        .toEqual(['combine: shape mismatch: [2, 3] and [2, 4]']);
    expect(messages(helper + 'A = array shape 2 3 fill 0\nB = array shape 1 3 fill 0\nC = A B combine\nC # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
});

it('does not preserve caller facts through unknown calls, mutations or recursive helpers', () => {
    for (const body of ['X external\n return X + 1', 'X 0 = 1\n return X + 1', 'return X helper',
        'X delete\n return X + 1', 'X += 1\n return X + 1', 'Y = stdin .integer\n return X + 1']) {
        expect(messages(`fun helper X\n ${body}\nend\nInput = "bad"\nInput helper`)).toEqual([]);
    }
});

it('does not guess results for recursion and joins all covered return paths', () => {
    expect(messages('fun again X\n return X again\nend\nA = 1 again\nA = "x"')).toEqual([]);
    expect(messages('fun choose X\n if X\n  return 1\n end\n return "x"\nend\nA = Flag choose\nA = true'))
        .toEqual(['A has type integer or text and cannot receive boolean']);
    expect(messages('fun choose X\n if X\n  return 1\n end\nend\nA = Flag choose\nA = true'))
        .toEqual(['A has type integer and cannot receive boolean']);
});

it('uses a settled binding type for a direct return after an unknown branch', () => {
    const source = 'fun choose Flag Next\n Result = 1\n if Flag\n  Result = Next\n end\n return Result\nend\n';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const result = analyzeValues(parsed.value, new Map(), new Map(), [{
        name: 'choose', arguments: [{ types: ['boolean'], rank: 0, shape: [] }, { types: [] }],
    }]);
    expect(result.functionResults[0].types).toEqual(['integer']);
    expect(result.diagnostics).toEqual([]);
});

it('infers the result of the unchanged CSES maximum-subarray loop', () => {
    const source = readFileSync(new URL('../../../demos/cses/sortnsrch/008_maxsubarray.ra', import.meta.url), 'utf8');
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source.slice(source.indexOf('fun max_subarray')));
    expect(parsed.parserErrors).toEqual([]);
    const result = analyzeValues(parsed.value, new Map(), new Map(), [{
        name: 'max_subarray', arguments: [{ types: ['array'], rank: 1, shape: [3], elements: ['integer'],
            eagerScalarCells: true }],
    }]);
    expect(result.functionResults[0].types).toEqual(['integer']);
    expect(result.diagnostics).toEqual([]);
    expect(messages(`${source.slice(source.indexOf('fun max_subarray'))}\nA = array 1 2 3\n`
        + 'Result = A max_subarray\nResult + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('infers scalar results from the unchanged AoC cookie clamp and unpack', () => {
    const source = readFileSync(new URL('../../../demos/aoc/2015/015_cookie.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/aoc/2015/015_cookie_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '015_cookie')
        .filter(example => example.name === 'cookiescore');
    expect(examples).toHaveLength(2);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults)
        .toEqual(examples.map(() => ({ types: ['integer', 'real'], rank: 0, shape: [] })));
});

it('infers booleans from the unchanged AoC indexed-window demo', () => {
    const source = readFileSync(new URL('../../../demos/aoc/2015/005_nice.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/aoc/2015/005_nice_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '005_nice')
        .filter(example => example.name === 'nice2');
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults)
        .toEqual(examples.map(() => ({ types: ['boolean'], rank: 0, shape: [] })));
});

it('infers an accumulator across the unchanged CSES dice array-write loop', () => {
    const source = readFileSync(new URL('../../../demos/cses/dynamic/001_dice.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/dynamic/001_dice_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '001_dice');
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults)
        .toEqual(examples.map(() => ({ types: ['integer'], rank: 0, shape: [] })));
});

it('proves scalar array cell types through closed plain and compound writes in nested loops', () => {
    const source = 'fun fill_array N\n A = array shape (N + 1) fill 0\n for I in 1 to N\n'
        + '  A I = A (I - 1) + 1\n end\n return A N\nend\n'
        + 'fun nested\n A = array 0 0\n for I in 0 to 1\n  for J in 0 to 1\n'
        + '   A J += 1\n  end\n end\n return A 0\nend\n';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    const result = analyzeValues(parsed.value, new Map(), new Map(), [
        { name: 'fill_array', arguments: [{ types: ['integer'], rank: 0, shape: [] }] },
        { name: 'nested', arguments: [] },
    ]);
    expect(result.functionResults.map(fact => fact.types)).toEqual([['integer'], ['integer']]);
    expect(result.diagnostics).toEqual([]);
    const mixed = source.replace('A I = A (I - 1) + 1', 'A I = "text"');
    const changed = services.Rank.parser.LangiumParser.parse<Program>(mixed);
    expect(analyzeValues(changed.value, new Map(), new Map(), [
        { name: 'fill_array', arguments: [{ types: ['integer'], rank: 0, shape: [] }] },
    ]).functionResults[0].types).toEqual([]);
});

it('proves full-cell writes across every axis without assuming slice writes are scalar', () => {
    const source = 'fun grid\n A = array shape 2 2 fill 0\n for I in 0 to 1\n'
        + '  for J in 0 to 1\n   A I J += 1\n  end\n end\n return A 0 0\nend\n';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value, new Map(), new Map(), [{ name: 'grid', arguments: [] }])
        .functionResults[0].types).toEqual(['integer']);
    const mixed = services.Rank.parser.LangiumParser.parse<Program>(source.replace('A I J += 1', 'A I J = "text"'));
    expect(analyzeValues(mixed.value, new Map(), new Map(), [{ name: 'grid', arguments: [] }])
        .functionResults[0].types).toEqual([]);
});

it('infers the unchanged AtCoder grid-path table', () => {
    const source = readFileSync(new URL('../../../demos/atcoder/edpc/08_grid1.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/atcoder/edpc/08_grid1_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '08_grid1', new Set(['path_count']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers the unchanged CSES book-shop dynamic program from its test inputs', () => {
    const source = readFileSync(new URL('../../../demos/cses/dynamic/007_bookshop.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/dynamic/007_bookshop_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '007_bookshop', new Set(['book_shop']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('infers indexed values from the unchanged CSES next-prime sequence', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/010_nextprime.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/math/010_nextprime_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '010_nextprime', new Set(['next_prime']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('widens array element facts before analyzing repeated writes', () => {
    expect(messages('Count = 1\nA = array 1 2\nfor I in 0 to 1\n A 0 = "x"\nend\n'
        + 'A 0 + 1\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Count = 1\nA = array 1 2\nfor I in 0 to 1\n A Key = 0\nend\n'
        + 'Count + "bad"')).toEqual([]);
});

it('infers returns from loops in unchanged reverse-integer and bill-count demos', () => {
    for (const [path, moduleName, type, rank] of [
        ['leetcode/007_revint', '007_revint', 'integer', 0],
        ['atcoder/beginners/010_otoshidama', '010_otoshidama', 'array', 1],
    ] as const) {
        const source = readFileSync(new URL(`../../../demos/${path}.ra`, import.meta.url), 'utf8');
        const tests = readFileSync(new URL(`../../../demos/${path}_test.ra`, import.meta.url), 'utf8');
        const program = services.Rank.parser.LangiumParser.parse<Program>(source);
        const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
        expect(program.parserErrors).toEqual([]);
        expect(testProgram.parserErrors).toEqual([]);
        const examples = functionTestExamples(testProgram.value, moduleName);
        const results = analyzeValues(program.value, new Map(), new Map(), examples).functionResults;
        expect(results.length).toBeGreaterThan(0);
        expect(results.every(result => result.types.join() === type && result.rank === rank)).toBe(true);
    }
});

it('does not infer scalar results for array-valued demo test examples', () => {
    const conflicts: string[] = [];
    const paths = [
        'demos/cody/43007_pd.ra',
        'demos/cses/range/025_missingcoins.ra',
        'demos/deepml/014_linreg.ra',
        'demos/deepml/015_gd.ra',
        'demos/deepml/022_sigmoid.ra',
        'demos/deepml/027_basis.ra',
        'demos/deepml/042_relu.ra',
        'demos/deepml/045_kernel.ra',
    ];
    for (const path of paths) {
        const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
        const tests = readFileSync(new URL(`../../../${path.replace(/\.ra$/, '_test.ra')}`, import.meta.url), 'utf8');
        const program = services.Rank.parser.LangiumParser.parse<Program>(source).value;
        const suite = services.Rank.parser.LangiumParser.parse<Program>(tests).value;
        const name = path.split('/').at(-1)!.replace(/\.ra$/, '');
        const examples = functionTestExamples(suite, name);
        const results = analyzeValues(program, new Map(), new Map(), examples).functionResults;
        for (const [index, example] of examples.entries()) {
            const result = results[index];
            if (!example.expected.types.length || !result.types.length) continue;
            if (!result.types.some(type => example.expected.types.includes(type))) {
                conflicts.push(`${path}:${example.line} ${example.name}: ${result.types} versus ${example.expected.types}`);
            }
            if (result.rank !== undefined && example.expected.rank !== undefined) {
                if (result.rank !== example.expected.rank) {
                    conflicts.push(`${path}:${example.line} ${example.name}: rank ${result.rank} versus ${example.expected.rank}`);
                }
            }
        }
    }
    expect(conflicts).toEqual([]);
});

it('retains unrelated facts after the unchanged maximum-subarray reader on eager input', () => {
    const source = readFileSync(new URL('../../../demos/cses/sortnsrch/008_maxsubarray.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun max_subarray'));
    expect(messages(`${definition}\nA = array 1 2 3\nCount = 3\nA max_subarray\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nA = array shape 3 fill 1\nCount = 3\nA max_subarray\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nA = array shape 3 fill Unknown\nCount = 3\nA max_subarray\nCount + "bad"`))
        .toEqual([]);
    expect(messages(`${definition}\nA = array shape 3 fill 1\nA 0 = Unknown\nCount = 3\nA max_subarray\nCount + "bad"`))
        .toEqual([]);
    const boundIndex = definition.replace(/\bi\b/g, 'I');
    expect(messages(`${boundIndex}\nI = 0\nA = array 1 2 3\nCount = 3\nA max_subarray\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
});

it('retains unrelated facts after the unchanged AtCoder vacation loop', () => {
    const source = readFileSync(new URL('../../../demos/atcoder/edpc/03_vacation.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun best_score'));
    expect(messages(`${definition}\nA = array 1 2 3\nB = array 3 2 1\nC = array 2 3 1\n`
        + 'Count = 3\nA B C best_score\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('retains unrelated facts after the unchanged bracket-count demo on integer input', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/017_brackets1.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun bracket_count'));
    expect(messages(`${definition}\nCount = 3\n6 bracket_count\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 3\nUnknown bracket_count\nCount + "bad"`))
        .toEqual([]);
});

it('retains unrelated facts after the unchanged palindrome loop on integer input', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/009_palnum.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun palindrome'));
    expect(messages(`${definition}\nCount = 3\n121 palindrome\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    const uncertain = definition.replace('Back = Back * 10 + Digit', 'Unknown external');
    expect(messages(`${uncertain}\nCount = 3\n121 palindrome\nCount + "bad"`)).toEqual([]);
});

it('retains unrelated facts after the unchanged reverse-integer loop with an early return', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/007_revint.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun reverse'));
    expect(messages(`${definition}\nCount = 3\n123 reverse\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nResult = 123 reverse\nResult + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    const uncertain = definition.replace('Result = Result * 10 + Digit', 'Unknown external');
    expect(messages(`${uncertain}\nCount = 3\n123 reverse\nCount + "bad"`)).toEqual([]);
});

it('retains caller facts across the unchanged modular-power demo for proven integer inputs', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/002_exponentiation.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun power'));
    expect(messages(`${definition}\nCount = 1\n3 4 power\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nUnknown 4 power\nCount + "bad"`)).toEqual([]);
});

it('retains caller facts across the unchanged sigmoid demo only for scalar input', () => {
    const source = readFileSync(new URL('../../../demos/deepml/022_sigmoid.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun sigmoid'));
    expect(messages(`${definition}\nCount = 1\n0.5 sigmoid\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\n(array 0 1) sigmoid\nCount + "bad"`)).toEqual([]);
});

it('retains caller facts across the unchanged recall demo only for callback-free cells', () => {
    const source = readFileSync(new URL('../../../demos/deepml/052_recall.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun recall'));
    expect(messages(`${definition}\nCount = 1\n(array 1 0) (array 1 1) recall\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 2 fill 1\nA (array 1 1) recall\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 2 fill Unknown\nA (array 1 1) recall\nCount + "bad"`))
        .toEqual([]);
});

it('drops a derived mask read proof after an indexed replacement', () => {
    const reader = 'fun count_mask Mask\n return Mask count\nend';
    const before = `${reader}\nMask = (array 1 0) equal 1\nCount = 1`;
    expect(messages(`${before}\nMask count_mask\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${before}\nMask 0 = "text"\nMask count_mask\nCount + "bad"`)).toEqual([]);
});

it('retains caller facts after the unchanged CSES sum-and-max reader', () => {
    const source = readFileSync(new URL('../../../demos/cses/sortnsrch/025_books.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun minimum_reading_time'));
    expect(messages(`${definition}\nCount = 1\n(array 2 3) minimum_reading_time\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 2 fill 1\nA minimum_reading_time\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 2 fill Unknown\nA minimum_reading_time\nCount + "bad"`))
        .toEqual([]);
});

it('retains caller facts across the unchanged softmax pipeline only for safe cells', () => {
    const source = readFileSync(new URL('../../../demos/deepml/023_softmax.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun softmax'));
    expect(messages(`${definition}\nCount = 1\n(array 1 2 3) softmax\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 3 fill 1\nA softmax\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nA = array shape 3 fill Unknown\nA softmax\nCount + "bad"`))
        .toEqual([]);
});

it('retains a caller fact after the unchanged normal-equation pipeline on eager arrays', () => {
    const source = readFileSync(new URL('../../../demos/deepml/014_linreg.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun linear_regression'));
    const matrix = 'X = array shape 3 2\n 1 1\n 1 2\n 1 3\nend';
    const vector = 'Y = array 1 2 3';
    expect(messages(`${definition}\nCount = 1\n${matrix}\n${vector}\nX Y linear_regression\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\n${matrix}\n${vector}\nResult = X Y linear_regression\nResult # #`))
        .toEqual(['2 selectors exceed array rank 1']);
    expect(messages(`${definition}\nCount = 1\nX = array shape 3 2 fill 1\n${vector}\nX Y linear_regression\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nX = array shape 3 2 fill Unknown\n${vector}\nX Y linear_regression\nCount + "bad"`))
        .toEqual([]);
});

it('retains a caller fact after the unchanged gradient-descent loop on numeric arrays', () => {
    const source = readFileSync(new URL('../../../demos/deepml/015_gd.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun linear_regression'));
    const matrix = 'X = array shape 3 2\n 1 1\n 1 2\n 1 3\nend';
    const vector = 'Y = array 1 2 3';
    expect(messages(`${definition}\nCount = 1\n${matrix}\n${vector}\nX Y 0.01 2 linear_regression\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(`${definition}\nCount = 1\nX = array shape 3 2 fill Unknown\n${vector}\nX Y 0.01 2 linear_regression\nCount + "bad"`))
        .toEqual([]);
});

it('skips an unreachable K-means loop body for a proven zero-step call', () => {
    const source = readFileSync(new URL('../../../demos/deepml/017_kmeans.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun k_means'));
    const points = 'Points = array shape 2 1\n 0\n 10\nend';
    const centroids = 'Centroids = array shape 2 1\n 0\n 10\nend';
    const draft = (steps: number) => `${definition}\nCount = 1\n${points}\n${centroids}`
        + `\nPoints 2 Centroids ${steps} k_means\nCount + "bad"`;
    expect(messages(draft(0))).toEqual(['operator + does not accept integer and text']);
    expect(messages(draft(1))).toEqual([]);
});

it('does not keep caller types across an arbitrary empty iterator', () => {
    const source = 'Count = 1\nfor Cell in Items\n Unknown external\nend\nCount + "bad"\n';
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    expect(program.parserErrors).toEqual([]);
    for (const type of ['array', 'sequence'] as const) {
        const items = { types: [type], rank: 1, shape: [0], elements: ['integer'] };
        expect(analyzeValues(program.value, new Map([['Items', items]])).diagnostics).toEqual([]);
    }
    expect(messages(source.replace('Items', '0 until 0')))
        .toEqual(['operator + does not accept integer and text']);
});

it('checks the result rank of the unchanged bill-count loop before execution', () => {
    const source = readFileSync(new URL('../../../demos/atcoder/beginners/010_otoshidama.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun otoshidama'));
    expect(messages(`${definition}\nResult = 9 45000 otoshidama\nResult # #`))
        .toEqual(['2 selectors exceed array rank 1']);
});

it('collects returns from reachable loop paths with break and continue', () => {
    for (const exit of ['break', 'continue']) {
        expect(messages(`fun choose N\n for I in 0 until N\n  if I equal 0\n   ${exit}\n  end\n  return 1\n end\n return "text"\nend\nA = 2 choose\nA = true`))
            .toEqual(['A has type integer or text and cannot receive boolean']);
        expect(messages(`fun choose\n for I in 1 to 2\n  ${exit}\n  return 1\n end\n return "text"\nend\nA = choose\nA = true`))
            .toEqual(['A has type text and cannot receive boolean']);
    }
    expect(messages('fun choose\n for I in 1 to 2\n  for J in 1 to 2\n   break\n  end\n  return 1\n end\n return "text"\nend\nA = choose\nA = true'))
        .toEqual(['A has type integer or text and cannot receive boolean']);
    expect(messages('fun choose\n for I in 0 until 0\n  return "text"\n end\n return 1\nend\nA = choose\nA = true'))
        .toEqual(['A has type integer and cannot receive boolean']);
});

it('keeps settled types after loop exits without trusting writes or unknown effects', () => {
    expect(messages('A = 1\nfor I in 1 to 3\n if I equal 2\n  break\n end\nend\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('A = 1\nfor I in 1 to 3\n A external\n break\nend\nA + "bad"'))
        .toEqual([]);
    expect(messages('A = array 1 2\nfor I in 1 to 3\n A = array 1 2 3\n break\nend\nA + (array 1 2 3)'))
        .toEqual([]);
});

it('infers the unchanged atoi function through both break and return paths', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/008_atoi.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/leetcode/008_atoi_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '008_atoi', new Set(['atoi', 'clamp']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer']));
});

it('retains unrelated facts after the unchanged marble-count text loop', () => {
    const source = readFileSync(new URL('../../../demos/atcoder/beginners/003_marbles.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun marbles'));
    expect(messages(`${definition}\nCount = 3\n"101" marbles\nCount + "bad"`))
        .toEqual(['operator + does not accept integer and text']);
    const uncertain = definition.replace('Count += 1', 'Unknown external');
    expect(messages(`${uncertain}\nCount = 3\n"101" marbles\nCount + "bad"`)).toEqual([]);
});

it('still discards facts after an unknown call inside a loop', () => {
    expect(messages('A = array 1 2\nfor I in 0 until 1\n A external\nend\nA 0 + "bad"'))
        .toEqual([]);
});

it('does not snapshot a direct-call argument that executes another function', () => {
    expect(messages('fun touch\n Unknown external\n return 0\nend\n'
        + 'fun inspect X Y\n return Y 0\nend\n'
        + 'A = array 1 2\nResult = touch A inspect\nResult + "bad"')).toEqual([]);
});

it('preserves unrelated scalar facts across known parameter and captured writes', () => {
    for (const target of ['X', 'Shared']) {
        expect(messages(`fun change X\n ${target} 0 = 1\n return 0\nend\nShared = array 1 2\nCount = 3\nShared change\nCount + "bad"`))
            .toEqual(['operator + does not accept integer and text']);
    }
    expect(messages('fun write X\n X 0 = 1\n return 0\nend\nfun helper X\n X write\n return 0\nend\nA = array 1 2\nCount = 3\nA helper\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('retains caller facts after a helper writes only its caller’s private array', () => {
    const code = 'fun write V\n V 0 = 9\n return 0\nend\n'
        + 'fun outer\n Temp = array 1 2\n Temp write\n return 0\nend\n';
    expect(messages(code + 'Count = 3\nouter\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(code.replace('Temp = array 1 2', 'Temp = Source')
        + 'Count = 3\nouter\nCount + "bad"')).toEqual([]);
});

it('maps a direct nested reader or writer to the enclosing argument', () => {
    const reader = 'fun outer X\n fun read\n  return X 0\n end\n return read\nend\n';
    expect(messages(reader + 'A = array 1 2\nCount = 3\nA outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    const writer = 'fun outer X\n fun change\n  X 0 = "x"\n  return 0\n end\n change\n return 0\nend\n';
    expect(messages(writer + 'A = array 1 2\nCount = 3\nA outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(writer + 'A = array 1 2\nA outer\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun outer X\n X = Source\n fun read\n  return X 0\n end\n return read\nend\n'
        + 'A = array 1 2\nCount = 3\nA outer\nCount + "bad"')).toEqual([]);
});

it('keeps unrelated facts across proven eager-cell reader helpers', () => {
    const readers = 'fun read X\n return X 0\nend\nfun helper A\n return A read\nend\n';
    expect(messages(readers + 'A = array 1 2\nCount = 3\nA helper\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun read\n return Shared 0\nend\nShared = array 1 2\nCount = 3\nread\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(readers + 'A = array 1 2\nA 0 = 3\nCount = 3\nA helper\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('reads top-level captures rather than equally named caller parameters', () => {
    const reader = 'Shared = array 1 2\nCount = 3\nfun read\n return Shared 0\nend\n'
        + 'fun outer Shared\n return read\nend\n';
    expect(messages(reader + '(array 3 4) outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(reader.replace('Shared = array 1 2', 'Shared = Unknown')
        + '(array 3 4) outer\nCount + "bad"')).toEqual([]);

    expect(messages('Offset = 1\nfun read Ignored\n return Offset\nend\n'
        + 'fun outer Offset\n return 1 read\nend\nResult = "x" outer\nResult + "y"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('Shared = array 1 2\nfun read Ignored\n return Shared 0\nend\n'
        + 'fun outer Ignored\n Shared 0 = "x"\n return 0 read\nend\nResult = 0 outer\nResult + 1'))
        .toEqual([]);
});

it('invalidates a global capture rather than an equally named caller parameter', () => {
    const prefix = 'Shared = array 1 2\nOther = array 3 4\nCount = 3\n'
        + 'fun write Value\n Shared 0 = Value\n return 0\nend\n'
        + 'fun outer Shared\n 9 write\n return Shared 0\nend\n';
    expect(messages(prefix + 'Other outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(prefix + 'Other outer\nShared + "bad"')).toEqual([]);
    expect(messages(prefix + 'Other outer\nOther + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('keeps unrelated facts across a reader of its own eager literal array', () => {
    const reader = 'fun read X\n return X 0\nend\nfun helper\n Temp = array 1 2\n return Temp read\nend\n';
    expect(messages(reader + 'Count = 3\nhelper\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun helper\n Temp = Source\n return Temp 0\nend\nCount = 3\nhelper\nCount + "bad"'))
        .toEqual([]);
});

it('keeps unrelated shapes across a private literal array write', () => {
    const build = 'fun build\n Temp = array 1 2\n Temp 0 = 9\n return Temp\nend\n';
    expect(messages(build + 'A = array 1 2\nbuild\nA + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
    const read = build.replace('return Temp', 'return Temp 0');
    expect(messages(read + 'A = array 1 2\nbuild\nA + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
});

it('keeps unrelated facts across a nested reader of its parent eager array', () => {
    const body = 'fun outer N\n Temp = array 1 2\n fun read\n  return Temp 0\n end\n return read\nend\n';
    expect(messages(body + 'Count = 3\n0 outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(body.replace('fun read', 'Temp = Source\n fun read')
        + 'Count = 3\n0 outer\nCount + "bad"')).toEqual([]);
    const second = body.replace('Temp = array 1 2', 'Other = array 3 4\n Temp = array 1 2');
    expect(messages(second + 'Count = 3\n0 outer\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('does not trust indexed readers of lazy or unsupported array values', () => {
    const reader = 'fun read X\n return X 0\nend\n';
    expect(messages(reader + 'A = Unknown\nCount = 3\nA read\nCount + "bad"')).toEqual([]);
    expect(messages(reader + 'A = array 1 2\nA # = Unknown\nCount = 3\nA read\nCount + "bad"')).toEqual([]);
    expect(messages(reader + 'A = array 1 2\nA 0 = Unknown\nCount = 3\nA read\nCount + "bad"')).toEqual([]);
});

it('does not retain facts across direct or transitive stdin reads', () => {
    const prefix = 'fun input\n return stdin .integer\nend\nCount = 3\n';
    expect(messages(prefix + 'input\nCount + "bad"')).toEqual([]);
    expect(messages('fun helper\n return input\nend\n' + prefix + 'helper\nCount + "bad"')).toEqual([]);
});

it('invalidates facts across direct I/O and mutation operations', () => {
    expect(messages('use io\nCount = 3\nstdin .integer\nCount + "bad"')).toEqual([]);
    expect(messages('use io\nCount = 3\n"path" read\nCount + "bad"')).toEqual([]);
    expect(messages('fun file Path\n return Path read\nend\nCount = 3\n"path" file\nCount + "bad"'))
        .toEqual([]);
    expect(messages('use algo\nCount = 3\nQ = new queue\nQ pop\nCount + "bad"')).toEqual([]);
});

it('follows copy-on-write when a function writes a parameter array', () => {
    const code = 'fun change X\n X 0 = 9\n return X\nend\nA = array 1 2\nB = A\nC = array 3 4 5\n';
    expect(messages(code + 'Result = B change\nA + C')).toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(code + 'Result = B change\nB + C')).toEqual(['shape mismatch: [2] and [3]']);
    expect(messages('A = array 1 2\nB = A\nB 0 = 9\nA + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
});

it('invalidates the written binding while retaining independent array facts', () => {
    const code = 'A = array 1 2\nB = A\nC = array 3 4 5\n';
    expect(messages(code + 'A 0 = "x"\nB + C'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(code + 'fun change\n A 0 = "x"\n return 0\nend\nchange\nB + C'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(code + 'fun change\n A 0 = "x"\n return 0\nend\nchange\nA + (array 1 2)'))
        .toEqual([]);
});

it('uses proven integer selectors through assignments and branch joins', () => {
    const code = 'I = 0\nA = array 1 2\nB = A\nC = array 3 4 5\n';
    expect(messages(code + 'A I = 9\nB + C'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(code + 'if Flag\n A I = 9\nend\nB + C'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(code + 'A I = "x"\nA + (array 3 4)')).toEqual([]);
    expect(messages('Key = .n\nA = array true false\nB = A\nA Key = 1\nB + 1'))
        .toEqual([]);
});

it('retains known cell types after a proven single-cell replacement', () => {
    const code = 'A = array 1 2\nB = A\nA 0 = 3\n';
    expect(messages(code + 'A + (array true false)'))
        .toEqual(['operator + does not accept integer and boolean']);
    expect(messages(code + 'B + (array true false)'))
        .toEqual(['operator + does not accept integer and boolean']);
    expect(messages('A = array 1 2\nif Flag\n A 0 = 3\nend\nA + (array true false)'))
        .toEqual(['operator + does not accept integer and boolean']);
    expect(messages('A = array 1 2\nA 0 = true\nA + (array 3 4)')).toEqual([]);
    expect(messages('A = array 1 2\nA # = 3\nA + (array true false)')).toEqual([]);
    expect(messages('A = array 1 2\nA 0 += 3\nA + (array true false)'))
        .toEqual(['operator + does not accept integer and boolean']);
    expect(messages('A = array 1 2\nA 0 %= 3\nA + (array true false)'))
        .toEqual(['operator + does not accept integer and boolean']);
    expect(messages('A = array 1 2\nA 0 += "text"\nA + (array true false)')).toEqual([]);
});

it('keeps array values separate across rebinding and joined write paths', () => {
    expect(messages('A = array 1 2\nB = A\nA = array 3 4 5\nB + A'))
        .toEqual(['shape mismatch: [2] and [3]']);
    const prefix = 'A = array 1 2\nC = array 3 4 5\nif Flag\n B = A\nelse\n B = C\nend\nB 0 = 9\n';
    expect(messages(prefix + 'A + C')).toEqual(['shape mismatch: [2] and [3]']);
    expect(messages(prefix + 'B + A')).toEqual([]);
    expect(messages('A = array 1 2\nB = A * 2\nA 0 = 9\nB + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
});

it('distinguishes local assignment from a possible nested capture', () => {
    expect(messages('A = array 1 2\nfun change\n A = array 1 2 3\n return 0\nend\nchange\nA + (array 1 2)'))
        .toEqual([]);
    expect(messages('A = array 1 2\nfun change\n A = array 1 2 3\n return 0\nend\nchange\nA + (array 1 2 3)'))
        .toEqual(['shape mismatch: [2] and [3]']);
    expect(messages('fun outer\n A = array 1 2\n fun change\n  A = array 1 2 3\n  return 0\n end\n change\n return A\nend\nR = outer\nR + (array 1 2)'))
        .toEqual([]);
});

it('retains unrelated shapes across a proven nested parameter rebinding', () => {
    const body = 'fun outer X\n Y = array 1 2\n fun replace\n  X = array 3 4 5\n  return 0\n end\n replace\n return Y + (array 1 2 3)\nend\nA = array 1 2\nA outer';
    expect(messages(body)).toEqual(['outer: shape mismatch: [2] and [3]']);
    expect(messages(body.replace('return Y + (array 1 2 3)', 'return X + (array 1 2)'))).toEqual([]);
});

it('invalidates a captured local binding without losing independent shapes', () => {
    const body = 'fun outer X\n Y = array 1 2\n Z = array 3 4\n fun replace\n  Y = array 5 6 7\n  return 0\n end\n replace\n return Z + (array 1 2 3)\nend\n0 outer';
    expect(messages(body)).toEqual(['outer: shape mismatch: [2] and [3]']);
    expect(messages(body.replace('return Z + (array 1 2 3)', 'return Y + (array 1 2)'))).toEqual([]);
    const second = body.replace('Y = array 5 6 7', 'Z = array 5 6 7');
    expect(messages(second.replace('return Z + (array 1 2 3)', 'return Y + (array 1 2 3)')))
        .toEqual(['outer: shape mismatch: [2] and [3]']);
    expect(messages(second.replace('return Z + (array 1 2 3)', 'return Z + (array 1 2)'))).toEqual([]);
});

it('keeps independent facts through a grandchild replacement of an outer local', () => {
    const source = 'fun outer\n Z = array 1 2\n Y = array 3 4\n fun middle\n  fun replace\n   Z = array 5 6 7\n   return 0\n  end\n  replace\n  return 0\n end\n middle\n return Y + (array 1 2 3)\nend\nouter';
    expect(messages(source)).toEqual(['outer: shape mismatch: [2] and [3]']);
    expect(messages(source.replace('return Y + (array 1 2 3)', 'return Z + (array 1 2)'))).toEqual([]);
});

it('drops caller facts when a nested helper name is redefined', () => {
    const source = 'fun outer A\n fun reader X\n  X 0 = 9\n  return 0\n end\n A reader\n fun reader X\n  return X 0\n end\n return 0\nend\nA = array 1 2\nCount = 3\nA outer\nCount + "bad"';
    expect(messages(source)).toEqual([]);
});

it('falls back for unknown effects and reference-like writes', () => {
    const prefix = 'fun change X\n X 0 = 1\n return 0\nend\nA = array true false\nAlias = A\nCount = 3\n';
    expect(messages(prefix + 'A change\nAlias + 1')).toEqual(['operator + does not accept boolean and integer']);
    expect(messages(prefix + 'A external\nCount + "bad"')).toEqual([]);
    expect(messages(prefix + 'Unknown change\nCount + "bad"')).toEqual([]);
    expect(messages('fun change X\n Alias = X\n Alias 0 = 1\n return 0\nend\nA = array 1 2\nCount = 3\nA change\nCount + "bad"')).toEqual([]);
    expect(messages('A = array true false\nB = A\nA 0 += 1\nB + 1')).toEqual([]);
});

it('joins function result dimensions without freezing elastic lengths', () => {
    expect(messages('fun choose X\n if X\n  return array shape 2 3 fill 0\n else\n  return array shape 4 3 fill 0\n end\nend\nA = Flag choose\nA # # #'))
        .toEqual(['3 selectors exceed array rank 2']);
});

it('infers result facts only from paths that return', () => {
    expect(messages('fun choose Flag\n if Flag\n  return array 1 2\n end\nend\nA = true choose\nA # #'))
        .toEqual(['2 selectors exceed array rank 1']);
    expect(messages('fun choose Flag\n if Flag\n  return 1\n end\nend\nA = true choose\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun fail\n Value = 1\nend\nA = fail\nA + "bad"')).toEqual([]);
});

it('keeps a text parameter when an implicit queue selects its characters', () => {
    const source = 'fun reorder Text\n for I in 0 until 2\n  queue push I\n end\n return Text queue\nend\nA = "abc" reorder';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value).bindings.get('A')?.types).toEqual(['text']);
    expect(messages('fun character Text I\n return Text I\nend\nA = "abc" 1 character\nA + 1'))
        .toEqual(['operator + does not accept text and integer']);
});

it('binds each matrix row as an array when iterating its first axis', () => {
    const source = 'fun first_cell Matrix\n for Row in Matrix\n  return Row 0\n end\nend\n'
        + 'A = (array 1 2 3 4 shape 2 2) first_cell';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value).bindings.get('A')?.types).toEqual(['integer']);
    const rows = services.Rank.parser.LangiumParser.parse<Program>(source.replace('return Row 0', 'return Row') + '\n');
    expect(analyzeValues(rows.value).bindings.get('A')).toMatchObject({ types: ['array'], rank: 1 });
    expect(messages(source.replace('return Row 0', 'return Row 0 0')))
        .toEqual(['first_cell: 2 selectors exceed array rank 1']);
    const empty = 'fun empty\n Matrix = array shape 0 2 fill 0\n for Row in Matrix\n  return 1\n end\n return "x"\nend\nA = empty';
    expect(analyzeValues(services.Rank.parser.LangiumParser.parse<Program>(empty + '\n').value)
        .bindings.get('A')?.types).toEqual(['text']);
});

it('preserves scalar cells through a proven integer spread index', () => {
    const source = 'fun write Position\n A = array shape 2 2 fill 0\n for I in 0 until 2\n'
        + '  A unpack Position += 1\n end\n return A 0 1\nend\nResult = (array 0 1) write';
    const parse = (body: string) => services.Rank.parser.LangiumParser.parse<Program>(body + '\n').value;
    expect(analyzeValues(parse(source)).bindings.get('Result')?.types).toEqual(['integer']);
    expect(analyzeValues(parse(source.replace('array 0 1', 'array 0'))).bindings.get('Result')?.types).toEqual([]);
    expect(analyzeValues(parse(source.replace('array 0 1', 'array 0.5 1'))).bindings.get('Result')?.types).toEqual([]);
});

it('keeps numeric matrix cells only when loop rebindings are closed', () => {
    const source = 'fun combine Base\n Result = array shape 2 2 fill 1\n'
        + ' for I in 0 until 3\n  Result = Result Base matmul\n end\n return Result 0 0\nend\n'
        + 'A = (array 1 2 3 4 shape 2 2) combine';
    const parse = (body: string) => services.Rank.parser.LangiumParser.parse<Program>(body + '\n').value;
    expect(analyzeValues(parse(source)).bindings.get('A')?.types).toEqual(['integer', 'real']);
    const broken = source.replace('Result = Result Base matmul\n end',
        'Result = Result Base matmul\n  if I equal 1\n   Result = "bad"\n  end\n end');
    expect(analyzeValues(parse(broken)).bindings.get('A')?.types).toEqual([]);
    expect(messages('A = array shape 2 2 fill 1\nfor I in 0 until 2\n'
        + ' A = array shape 2 3 fill 1\nend\nA + (array shape 2 4 fill 1)')).toEqual([]);
});

it('joins integer and real cells across proven matrix writes in a loop', () => {
    const source = 'fun build_matrix Size\n M = array shape Size Size fill infinity\n'
        + ' for I in 0 until Size\n  M I I = 0\n end\n return M 0 0\nend\nA = 2 build_matrix';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    expect(analyzeValues(parsed.value).bindings.get('A')?.types).toEqual(['real', 'integer']);
    expect(messages('A = array shape 2 2 fill 0\nfor I in 0 until 2\n A I I = 1\nend\nA 0 0 + "x"'))
        .toEqual(['operator + does not accept integer and text']);
});

it('keeps the unchanged LCS element type before widening numeric loop cells', () => {
    const source = readFileSync(new URL('../../../demos/cses/dynamic/011_lcs.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/dynamic/011_lcs_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    const examples = functionTestExamples(testProgram.value, '011_lcs', new Set(['longest_common']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['array']));
});

it('does not close a numeric loop through an effectful helper', () => {
    const source = 'fun impure X\n Unknown external\n return X\nend\n'
        + 'fun compute\n A = array 1 2\n for I in 0 until 2\n  A = A impure\n end\n return A 0\nend\nResult = compute';
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(analyzeValues(parsed.value).bindings.get('Result')?.types).toEqual([]);
});

it('infers the unchanged CSES min-plus graph-path result through safe helpers', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/024_graphpaths2.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/math/024_graphpaths2_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '024_graphpaths2', new Set(['min_path']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer', 'real']));
});

it('retains a private scalar parameter type but not its value across an unknown call', () => {
    const source = 'fun outer N\n Unknown external\n return N + 1\nend\nA = 3 outer';
    const parse = (body: string) => services.Rank.parser.LangiumParser.parse<Program>(body + '\n').value;
    expect(analyzeValues(parse(source)).bindings.get('A')?.types).toEqual(['integer']);
    const withCapture = source.replace(' Unknown external', ' fun nested\n  N = 4\n  return 0\n end\n Unknown external');
    expect(analyzeValues(parse(withCapture)).bindings.get('A')?.types).toEqual([]);
});

it('infers the unchanged CSES graph-path matrix result', () => {
    const source = readFileSync(new URL('../../../demos/cses/math/023_graphpaths1.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/cses/math/023_graphpaths1_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '023_graphpaths1', new Set(['path_count']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['integer', 'real']));
});

it('infers the unchanged Zigzag demo from its test inputs', () => {
    const source = readFileSync(new URL('../../../demos/leetcode/006_zigzag.ra', import.meta.url), 'utf8');
    const tests = readFileSync(new URL('../../../demos/leetcode/006_zigzag_test.ra', import.meta.url), 'utf8');
    const program = services.Rank.parser.LangiumParser.parse<Program>(source);
    const testProgram = services.Rank.parser.LangiumParser.parse<Program>(tests);
    expect(program.parserErrors).toEqual([]);
    expect(testProgram.parserErrors).toEqual([]);
    const examples = functionTestExamples(testProgram.value, '006_zigzag', new Set(['zigzag']));
    expect(examples.length).toBeGreaterThan(0);
    expect(analyzeValues(program.value, new Map(), new Map(), examples).functionResults.map(fact => fact.types))
        .toEqual(examples.map(() => ['text']));
});

it('infers returns through try and catch without assuming partial writes', () => {
    const parse = (source: string) => services.Rank.parser.LangiumParser.parse<Program>(source + '\n').value;
    const both = 'fun choose\n try\n  return 1\n catch Error\n  return "fallback"\n end\nend\nA = choose';
    expect(analyzeValues(parse(both)).bindings.get('A')?.types).toEqual(['integer', 'text']);
    const caught = 'fun choose\n Value = 1\n try\n  Value = 2\n  1 / 0\n catch Error\n  return Value\n end\nend\nA = choose';
    expect(analyzeValues(parse(caught)).bindings.get('A')?.types).toEqual([]);
    expect(messages('fun choose\n try\n  return array 1 2\n catch Error\n  return array 3 4\n end\nend\nA = choose\nA # #'))
        .toEqual(['2 selectors exceed array rank 1']);
});

it('does not analyze statements after a definite no-return call', () => {
    const fail = 'fun fail\n Value = 1\nend\n';
    expect(messages(fail + 'fail\nA = 1\nA + "bad"')).toEqual([]);
    expect(messages(fail + 'A = fail\nA + "bad"')).toEqual([]);
    expect(messages('fun fail\n fun nested\n  return 1\n end\n nested\nend\nfail\nA = 1\nA + "bad"'))
        .toEqual([]);
    expect(messages(fail + 'if Flag\n fail\nelse\n A = 1\nend\nA + "bad"')).toEqual([]);
    expect(messages(fail + 'fun choose Flag\n if Flag\n  fail\n else\n  return 1\n end\nend\nA = true choose\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages('fun stream\n if false\n  yield 1\n end\nend\nstream\nA = 1\nA + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
    expect(messages(fail + 'try\n fail\ncatch Error\n A = 1\nend\nA + "bad"')).toEqual([]);
});

it('infers a generator sequence without executing its body', () => {
    const source = 'fun stream\n if false\n  yield 1\n end\nend\nS = stream\n';
    expect(messages(source + 'S = 1')).toEqual(['S has type sequence and cannot receive integer']);
    expect(messages(source + 'A = S array\nA # #')).toEqual(['2 selectors exceed array rank 1']);
    expect(messages('fun stream\n yield array 1 2\nend\nA = stream array\nA # #')).toEqual([]);
    expect(messages('fun outer\n fun inner\n  yield 1\n end\n return 2\nend\nA = outer\nA = true'))
        .toEqual(['A has type integer and cannot receive boolean']);
    const parse = (source: string) => services.Rank.parser.LangiumParser.parse<Program>(source + '\n').value;
    expect(analyzeValues(parse('fun stream X\n yield X\nend\nS = 1 stream')).bindings.get('S'))
        .toMatchObject({ types: ['sequence'], elements: ['integer'], rank: 1 });
    expect(analyzeValues(parse('fun stream\n yield 1\n yield "x"\nend\nS = stream')).bindings.get('S')?.elements)
        .toEqual(['integer', 'text']);
    expect(messages('fun stream\n yield 1\n yield "x"\nend'))
        .toEqual(['stream yields incompatible types: integer and text']);
    expect(messages('fun stream\n if false\n  yield 1\n end\n yield "x"\nend')).toEqual([]);
    expect(messages('fun stream\n return\n yield 1\n yield "x"\nend')).toEqual([]);
    expect(messages('fun stream Flag\n if Flag\n  return\n else\n  return\n end\n yield 1\n yield "x"\nend'))
        .toEqual([]);
    expect(messages('fun stream X\n yield 1\n yield X\nend\nS = "x" stream'))
        .toEqual(['stream yields incompatible types: integer and text']);
    expect(messages('fun stream\n Cell = 1\n yield Cell\n yield "x"\nend'))
        .toEqual(['stream yields incompatible types: integer and text']);
    expect(messages('fun stream X\n Cell = X\n yield Cell\n yield 1\nend\nS = "x" stream'))
        .toEqual(['stream yields incompatible types: text and integer']);
    expect(messages('fun stream\n First = "x"\n Second = First\n yield Second\n yield 1\nend'))
        .toEqual(['stream yields incompatible types: text and integer']);
    expect(messages('fun stream Flag\n Cell = 1\n if Flag\n  Cell = "x"\n end\n yield Cell\n yield "x"\nend'))
        .toEqual([]);
    expect(messages('fun stream X\n yield 1\n yield X\nend\nS = Unknown stream')).toEqual([]);
    expect(analyzeValues(parse('fun stream X\n X = "changed"\n yield X\nend\nS = 1 stream')).bindings.get('S')?.elements)
        .toBeUndefined();
    expect(analyzeValues(parse('Shared = 1\nfun stream\n yield Shared\nend\nS = stream')).bindings.get('S')?.elements)
        .toBeUndefined();
});

it('checks reshape element counts when source and target dimensions are known', () => {
    expect(messages('use sequences\nA = (1 to 5) (array 2 3) reshape'))
        .toEqual(['reshape expects 6 elements, got 5']);
    expect(messages('use sequences\nA = (1 to 6) (array 2 3) reshape')).toEqual([]);
});

it('allows integer addressing to continue into a text array element', () => {
    expect(messages('A = array "ab" "cd"\nA 0 1')).toEqual([]);
});

it('invalidates dimensions for a potentially effectful call inside a branch', () => {
    expect(messages('A = array 1 2\nfun change\n A = array 1 2 3\nend\nif Flag\n change\nend\nB = array 1 2 3\nA + B')).toEqual([]);
});

it('does not apply builtin reshape rules to a local function with the same name', () => {
    expect(messages('fun reshape A B\n return 1\nend\nX = (array 1 2) (array 3 4) reshape'))
        .toEqual([]);
});

it('does not report an error in an unproven or unreachable function branch', () => {
    expect(messages('fun choose X\n if X\n  return 1 + "bad"\n end\n return 0\nend\nfalse choose')).toEqual([]);
    expect(messages('fun choose X\n if false\n  return 1 + "bad"\n end\n return 0\nend\nfalse choose')).toEqual([]);
});

it('checks known array element types while treating text as a broadcast atom', () => {
    expect(messages('A = array true false\nB = array 1 2\nA + B'))
        .toEqual(['operator + does not accept boolean and integer']);
    expect(messages('A = "prefix" + (array "a" "b")\nB = array "c" "d"\nA + B')).toEqual([]);
});
