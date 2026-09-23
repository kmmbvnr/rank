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

it('checks the result rank of the unchanged bill-count loop before execution', () => {
    const source = readFileSync(new URL('../../../demos/atcoder/beginners/010_otoshidama.ra', import.meta.url), 'utf8');
    const definition = source.slice(source.indexOf('fun otoshidama'));
    expect(messages(`${definition}\nResult = 9 45000 otoshidama\nResult # #`))
        .toEqual(['2 selectors exceed array rank 1']);
});

it('keeps unsupported loop exits unknown when inferring returned values', () => {
    for (const exit of ['break', 'continue']) {
        expect(messages(`fun choose N\n for I in 0 until N\n  if I equal 0\n   ${exit}\n  end\n  return 1\n end\n return "text"\nend\nA = 2 choose\nA = true`))
            .toEqual([]);
    }
    expect(messages('fun choose\n for I in 0 until 0\n  return "text"\n end\n return 1\nend\nA = choose\nA = true'))
        .toEqual(['A has type integer and cannot receive boolean']);
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
