import { EmptyFileSystem } from 'langium';
import { expect, it } from 'vitest';
import { analyzeValues } from '../src/analysis/value-diagnostics.js';
import { variableDim } from '../src/analysis/shape-index.js';
import type { ValueFacts } from '../src/analysis/value-domain.js';
import type { Program } from '../src/generated/ast.js';
import { createRankServices } from '../src/rank-module.js';

const services = createRankServices(EmptyFileSystem);

function analyze(source: string, initial: ReadonlyMap<string, ValueFacts> = new Map()) {
    const parsed = services.Rank.parser.LangiumParser.parse<Program>(source + '\n');
    expect(parsed.parserErrors).toEqual([]);
    return { program: parsed.value, diagnostics: analyzeValues(parsed.value, initial).diagnostics };
}

it('diagnoses proven incompatible explicit and intrinsic binary frames', () => {
    const prefix = 'use numbers\nA = array shape 2 fill 2\nB = array shape 3 fill 2\n';
    for (const call of ['A B gcd rank 0 0', 'A B gcd']) {
        const { diagnostics } = analyze(prefix + 'R = ' + call);
        expect(diagnostics.map(item => [item.kind, item.message]))
            .toEqual([['DimensionMismatch', 'shape mismatch: [2] and [3]']]);
        expect(diagnostics[0].node.$cstNode?.text).toContain(call);
    }
    const matrices = 'use numbers\nA = array shape 2 2 fill 2\nB = array shape 3 2 fill 2\n';
    expect(analyze(matrices + 'R = A B gcd rank -1 -1').diagnostics.map(item => item.message))
        .toEqual(['shape mismatch: [2] and [3]']);
});

it('accepts singleton stretching, zero with one, and scalar frames', () => {
    for (const [left, right] of [
        ['array shape 2 1 fill 2', 'array shape 1 3 fill 2'],
        ['array shape 0 fill 2', 'array shape 1 fill 2'],
        ['2', 'array shape 2 3 fill 2'],
    ]) {
        const source = `use numbers\nA = ${left}\nB = ${right}\nR = A B gcd`;
        expect(analyze(source).diagnostics, source).toEqual([]);
        expect(analyze(source + ' rank 0 0').diagnostics, source).toEqual([]);
    }
});

it('does not reject an unknown or symbolic axis inferred only from later use', () => {
    const initial = new Map<string, ValueFacts>([
        ['A', { types: ['array'], rank: 1, shape: [null], dims: [variableDim('n')], elements: ['integer'] }],
        ['B', { types: ['array'], rank: 1, shape: [3], elements: ['integer'] }],
    ]);
    expect(analyze('use numbers\nR = A B gcd rank 0 0\nR 0', initial).diagnostics).toEqual([]);
    expect(analyze('use numbers\nR = A B gcd', initial).diagnostics).toEqual([]);
});

it('forwards the located mismatch to editor validation', () => {
    const source = 'use numbers\nA = array shape 2 fill 2\nB = array shape 3 fill 2\nR = A B gcd rank 0 0';
    const { program } = analyze(source);
    const reported: { severity: string; message: string; code: unknown; text: string | undefined }[] = [];
    services.Rank.validation.RankValidator.checkExpressions(program, (severity, message, info) => {
        reported.push({ severity, message, code: info.code, text: info.node?.$cstNode?.text });
    });
    expect(reported).toContainEqual({ severity: 'error', message: 'shape mismatch: [2] and [3]',
        code: 'DimensionMismatch', text: 'A B gcd rank 0 0' });
});
