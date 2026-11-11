import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generate, print, features, minimize } from './generated-composition/grammar.js';
import { check, execute } from './generated-composition/execution.js';

const seed = Number(process.env.RANK_GENERATED_SEED ?? 565);
const count = Number(process.env.RANK_GENERATED_CASES ?? 64);
const start = Number(process.env.RANK_GENERATED_START ?? 0);
if (!Number.isSafeInteger(start) || start < 0 || start > 1000000 || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(count) || count < 1 || count > 4096) {
    throw new Error('Generated suite requires uint32 seed and 1..4096 cases');
}
const coverage = new Set<string>();
const combinations = new Set<string>();
const pairs: Record<string, number> = {};
let compiledEntries = 0, verified = 0;
describe('generated typed composition', () => {
    for (let index = start; index < start + count; index++) it(`seed ${seed} case ${index}`, () => {
        const caseSeed = (seed + Math.imul(index, 0x9e3779b9)) >>> 0;
        const program = generate(caseSeed);
        const present = features(program.expression);
        combinations.add(present.join(','));
        for (const feature of present) coverage.add(feature);
        for (let left = 0; left < present.length; left++) for (let right = left + 1; right < present.length; right++) {
            const key = `${present[left]} + ${present[right]}`;
            pairs[key] = (pairs[key] ?? 0) + 1;
        }
        const result = check(program);
        compiledEntries += result.compiledEntries;
        if (result.failure) {
            const kind = result.failure.kind;
            const reduced = minimize(program, candidate => check(candidate).failure?.kind === kind);
            const failure = check(reduced.program).failure;
            const directory = process.env.RANK_GENERATED_FAILURE_DIR ?? mkdtempSync(join(tmpdir(), 'rank-generated-'));
            mkdirSync(directory, { recursive: true });
            const path = join(directory, `${seed}-${index}`);
            writeFileSync(`${path}.ra`, failure?.source ?? print(reduced.program));
            writeFileSync(`${path}.reference.ra`, print(reduced.program));
            writeFileSync(`${path}.json`, JSON.stringify({ seed, index, caseSeed, original: program,
                minimized: reduced.program, attempts: reduced.attempts, failure }, null, 2));
            throw new Error(`${kind}; seed ${seed}, case ${index}; minimized fixture: ${path}.ra\n${JSON.stringify(failure)}`);
        }
        verified++;
    });
    it('records exercised grammar and actual compiled entries', () => {
        if (seed === 565 && start === 0 && count >= 64) {
            for (const feature of ['fill', 'map', 'snapshot', 'record', 'queue', 'lazy', 'helper', 'higher', 'capture', 'effect', 'protected', 'generator', 'branch', 'loop']) {
                expect(coverage, feature).toContain(feature);
            }
            expect(compiledEntries).toBeGreaterThan(0);
            expect(combinations.size).toBeGreaterThan(30);
        }
        if (process.env.RANK_GENERATED_REPORT) writeFileSync(process.env.RANK_GENERATED_REPORT,
            JSON.stringify({ seed, start, count, features: [...coverage].sort(), combinations: combinations.size, pairs, compiledEntries, variantsPerCase: 9, casesPassed: verified, casesExpected: count }, null, 2));
    });
});

describe('generator and reducer contracts', () => {
    it('replays seeds deterministically and changes sources across seeds', () => {
        expect(generate(565)).toEqual(generate(565));
        expect(new Set(Array.from({ length: 32 }, (_, seed) => print(generate(seed)))).size).toBe(32);
    });
    it('reduces a reproducible failing oracle without making the program invalid', () => {
        const program = generate(565);
        const fails = (candidate: typeof program) => {
            const result = execute(print(candidate), false);
            return !result.outcome.error && features(candidate.expression).includes('record');
        };
        // This is a reducer self-test, not a claim of a compiler failure.
        const original = { ...program, expression: { type: 'record' as const, kind: 'record' as const,
            delta: 4, value: { type: 'integer' as const, kind: 'binary' as const, op: '+' as const,
                left: { type: 'integer' as const, kind: 'literal' as const, value: 8 },
                right: { type: 'integer' as const, kind: 'literal' as const, value: 3 } } } };
        const reduced = minimize(original, fails, 30);
        expect(fails(reduced.program)).toBe(true);
        expect(print(reduced.program).length).toBeLessThan(print(original).length);
        expect(reduced.attempts).toBeLessThanOrEqual(30);
        expect(minimize(original, fails, 30)).toEqual(reduced);
    });
    it('detects and reduces an injected compiler-only effect mismatch', () => {
        const program = { seed: 0, input: 1, expression: { type: 'record' as const, kind: 'record' as const,
            delta: 3, value: { type: 'integer' as const, kind: 'literal' as const, value: 42 } } };
        const mutated: typeof execute = (source, compilation, trace) => {
            const result = execute(source, compilation, trace);
            if (compilation && source.includes('record')) result.outcome.output.push('injected extra effect');
            return result;
        };
        const failure = check(program, mutated).failure;
        expect(failure?.kind).toBe('differential:compiled:effects');
        const reduced = minimize(program, candidate => check(candidate, mutated).failure?.kind === failure?.kind);
        expect(print(reduced.program).length).toBeLessThan(print(program).length);
        expect(check(reduced.program, mutated).failure?.kind).toBe(failure?.kind);
        expect(check(reduced.program).failure).toBeUndefined();
    });
    it('keeps invalid type-changing assignment errors in all execution modes', () => {
        const source = 'use io\nValue = 1\n"before" print\nValue = "bad"';
        const reference = execute(source, false).outcome;
        expect(reference.error).toBeDefined();
        expect(execute(source, true).outcome).toEqual(reference);
        expect(execute(source, true, true).outcome).toEqual(reference);
    });
});
