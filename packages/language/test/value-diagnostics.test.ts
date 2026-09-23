import { EmptyFileSystem } from 'langium';
import { beforeAll, expect, it } from 'vitest';
import { createRankServices } from '../src/rank-module.js';
import type { Program } from '../src/generated/ast.js';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';

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
        .toEqual([]);
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
    expect(messages('fun choose X\n if X\n  return 1\n end\nend\nA = Flag choose\nA = true')).toEqual([]);
});

it('preserves unrelated scalar facts across known parameter and captured writes', () => {
    for (const target of ['X', 'Shared']) {
        expect(messages(`fun change X\n ${target} 0 = 1\n return 0\nend\nShared = array 1 2\nCount = 3\nShared change\nCount + "bad"`))
            .toEqual(['operator + does not accept integer and text']);
    }
    expect(messages('fun write X\n X 0 = 1\n return 0\nend\nfun helper X\n X write\n return 0\nend\nA = array 1 2\nCount = 3\nA helper\nCount + "bad"'))
        .toEqual(['operator + does not accept integer and text']);
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
