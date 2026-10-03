import { describe, expect, it } from 'vitest';
import {
    findOperation, resultTypes, validateShapeSignature, moduleForms, modules, operations, type Operation, type SignatureType,
} from '@arrrank/language';
import { Interpreter, standardModules } from '../src/index.js';
import type { RuntimeContext } from '../src/modules/types.js';
import { isNativeFunction, typeName, type RankValue } from '../src/value.js';
import { TokenInput } from './support.js';

const context: RuntimeContext = {
    output: () => undefined,
    random: () => 0.5,
    seedRandom: () => undefined,
    ownFile: () => undefined,
};

/** Every exported name, resolved once so the catalogue can be compared to it. */
function runtimeNames(): Map<string, RankValue> {
    const names = new Map<string, RankValue>();
    for (const [module, exports] of Object.entries(standardModules)) {
        for (const [name, build] of Object.entries(exports)) {
            names.set(`${module}.${name}`, build(context));
        }
    }
    return names;
}

function describeArities(operation: Operation): string {
    return operation.arities.join('/');
}

describe('the operation catalogue', () => {
    const runtime = runtimeNames();

    it('describes every name the standard modules export', () => {
        const catalogued = new Set(operations.map(entry => `${entry.module}.${entry.name}`));
        const missing = [...runtime.keys()].filter(key => !catalogued.has(key));
        expect(missing).toEqual([]);
    });

    it('describes nothing the standard modules do not export', () => {
        const extra = [...catalogueKeys()].filter(key => !runtime.has(key));
        expect(extra).toEqual([]);
    });

    it('agrees with the runtime about arity and rank', () => {
        const wrong: string[] = [];
        for (const entry of operations) {
            const value = runtime.get(`${entry.module}.${entry.name}`)!;
            if (!isNativeFunction(value)) {
                if (entry.arities.length > 0) wrong.push(`${entry.name}: not an operation`);
                continue;
            }
            if (describeArities(entry) !== value.arities.join('/')) {
                wrong.push(
                    `${entry.name}: arities ${describeArities(entry)} against ` +
                    `${value.arities.join('/')}`,
                );
            }
            if ((entry.monadicRank ?? 'all') !== value.monadicRank) {
                wrong.push(`${entry.name}: monadic rank ${entry.monadicRank ?? 'all'}`);
            }
            const dyadic = entry.dyadicRanks === undefined
                ? undefined
                : entry.dyadicRanks.join(' ');
            if (dyadic !== value.dyadicRanks?.join(' ')) {
                wrong.push(`${entry.name}: dyadic ranks ${dyadic}`);
            }
        }
        expect(wrong).toEqual([]);
    });

    it('requires signatures for callable names and identifies form-only placeholders', () => {
        for (const entry of operations.filter(entry => entry.arities.length)) {
            if (entry.formOnly) {
                expect(entry.signatures, entry.name).toBeUndefined();
                const value = runtime.get(`${entry.module}.${entry.name}`)!;
                expect(isNativeFunction(value)).toBe(true);
                if (isNativeFunction(value)) expect(() => value.call([1n, 2n])).toThrow(/segment/);
            } else expect(entry.signatures?.length, entry.name).toBeGreaterThan(0);
        }
    });

    it('keeps display overload arities consistent with the runtime catalogue', () => {
        for (const entry of operations) for (const signature of entry.signatures ?? []) {
            expect(entry.arities, entry.name).toContain(signature.inputs.length);
            if (signature.ranks) expect(signature.ranks, entry.name).toHaveLength(signature.inputs.length);
        }
    });

    it('covers the audited reverse and split overloads with actual runtime results', () => {
        for (const [source, expected] of [
            ['use sequences\n"abc" reverse', 'text'],
            ['use sequences\n(array 1 2) reverse', 'array'],
            ['use sequences\n(1 to 3) reverse', 'array'],
            ['use algo\nuse sequences\nQ = new queue\nQ push 1\nQ reverse', 'array'],
            ['use algo\nuse sequences\nS = new stack\nS push 1\nS reverse', 'array'],
            ['use algo\nuse sequences\nD = new deque\nD 1 pushback\nD reverse', 'array'],
            ['use text\n"a,b;c" (array "," ";") split', 'array'],
            ['use text\n"a,b" "," split', 'array'],
        ]) {
            const value = new Interpreter().execute(source)!;
            expect(typeName(value), source).toBe(expected);
        }
    });

    it('keeps declared signature cell domains within unconditional operand requirements', () => {
        const scalar = new Set(['integer', 'real', 'text', 'boolean', 'symbol', 'missing', 'date', 'datetime', 'duration']);
        const domains = (type: SignatureType, cell = false): string[] => {
            if (typeof type === 'string') return type === 'number' ? ['integer', 'real']
                : scalar.has(type) || cell ? [type] : [];
            if ('label' in type) return ['symbol'];
            if ('union' in type) return type.union.flatMap(part => domains(part, cell));
            if ('collection' in type) return cell ? [type.collection] : domains(type.element, true);
            return [];
        };
        for (const entry of operations) for (const signature of entry.signatures ?? []) {
            signature.inputs.forEach((input, index) => {
                const allowed = entry.operandDomains?.[index];
                if (allowed) for (const domain of domains(input)) expect(allowed, `${entry.name} input ${index + 1}`).toContain(domain);
            });
        }
    });

    it('checks numeric reductions and ordered extrema against their display domains', () => {
        for (const [source, expected] of [
            ['3 sum', 'integer'], ['(array 1 2) sum', 'integer'], ['(array 1.0 2.0) sum', 'real'],
            ['use algo\nS = new set\nS add 2\nS add 3\nS sum', 'integer'],
            ['"a" "z" max', 'text'], ['false true min', 'boolean'], ['3 4.5 max', 'real'],
            ['.NA 3 max', 'missing'], ['3 .NA min', 'missing'],
        ]) expect(typeName(new Interpreter().execute(source)!), source).toBe(expected);
    });

    it('checks integer bit operations and hash input domains used by signatures', () => {
        for (const [source, expected] of [
            ['use bits\n3 1 band', 'integer'], ['use bits\n3 1 bor', 'integer'],
            ['use bits\n3 1 bxor', 'integer'], ['use bits\n3 bnot', 'integer'],
            ['use bits\n3 1 shl', 'integer'], ['use bits\n3 1 shr', 'integer'],
            ['use bits\n3 1 bit', 'boolean'], ['use bits\n3 popcount', 'integer'],
            ['use bits\n5 binary', 'text'], ['use bits\n5 4 binary', 'text'],
            ['use bits\n(array 1 2) 1 band', 'array'],
            ['use crypto\n"x" md5', 'bytes'], ['use crypto\n("x" bytes) md5', 'bytes'],
        ]) expect(typeName(new Interpreter().execute(source)!), source).toBe(expected);
        expect(() => new Interpreter().execute('use bits\n1.5 1 band')).toThrow();
        expect(() => new Interpreter().execute('use crypto\n(array 1 2) md5')).toThrow();
    });

    it('checks mapped date conversions and intrinsically ranked components', () => {
        for (const [expression, expected] of [
            ['"2026-10-03" date', 'date'], ['"2026-10-03" date datetime', 'datetime'],
            ['"2026-10-03 12:34:56" datetime date', 'date'],
            ['(array "2026-10-03" "2026-10-04") date', 'array'],
            ['(1 to 3) duration', 'sequence'], ['3.0 duration', 'duration'],
            ['3 duration seconds', 'integer'], ['(array 1 2) duration seconds', 'array'],
            ['"2026-10-03" date year', 'integer'], ['"2026-10-03" date weekday', 'integer'],
            ['"2026-10-03 12:34:56" datetime hour', 'integer'],
            ['"2026-10-03 12:34:56" datetime minute', 'integer'],
            ['"2026-10-03 12:34:56" datetime second', 'integer'],
            ['"2026-10-03" date monthstart', 'datetime'], ['"2026-10-03" date nextmonth', 'datetime'],
            ['"2026-10-03" "2026-10-04" calendar', 'array'],
        ]) expect(typeName(new Interpreter().execute('use dates\n' + expression)!), expression).toBe(expected);
        expect(() => new Interpreter().execute('use dates\n"2026-10-03" date hour')).toThrow();
        expect(() => new Interpreter().execute('use dates\n1.5 duration')).toThrow();
    });

    it('checks numeric signatures across scalar domains, maps and missing values', () => {
        for (const name of ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh',
            'tanh', 'asinh', 'acosh', 'atanh', 'log', 'exp']) {
            const argument = name === 'acosh' ? '2.0' : '0.5';
            expect(typeName(new Interpreter().execute(`use numbers\n${argument} ${name}`)!), name).toBe('real');
            expect(typeName(new Interpreter().execute(`use numbers\n.NA ${name}`)!), name).toBe('missing');
        }
        for (const [expression, expected] of [
            ['-3 abs', 'integer'], ['-3.0 abs', 'real'], ['.NA abs', 'missing'],
            ['4 sqrt', 'real'], ['.NA sqrt', 'missing'], ['4 isqrt', 'integer'],
            ['1 2 atan2', 'real'], ['.NA 2 atan2', 'missing'],
            ['5 2 binomial', 'integer'], ['.NA 2 binomial', 'missing'],
            ['5 2 7 binomialmod', 'integer'], ['2 3 7 powmod', 'integer'], ['6 4 gcd', 'integer'],
            ['6 4 lcm', 'integer'], ['(array 6 4) lcm', 'integer'], ['(1 to 3) lcm', 'integer'],
            ['12 factors', 'sequence'], ['12 divisors', 'sequence'], ['3 odd', 'boolean'],
            ['2 even', 'boolean'], ['.NA isnan', 'boolean'], ['1.25 1 round', 'real'], ['125 -1 round', 'integer'],
            ['(array 0.0 1.0) sin', 'array'], ['(0 to 2) sin', 'sequence'],
            ['(array 1 2) odd', 'array'], ['(1 to 3) odd', 'sequence'],
        ]) expect(typeName(new Interpreter().execute('use numbers\n' + expression)!), expression).toBe(expected);
        expect(() => new Interpreter().execute('use numbers\n.NA isqrt')).toThrow();
        expect(() => new Interpreter().execute('use numbers\n1.5 2 gcd')).toThrow();
        expect(() => new Interpreter().execute('use numbers\n.NA 2 round')).toThrow();
        expect(() => new Interpreter().execute('use algo\nuse numbers\nQ = new queue\nQ push 2\nQ lcm')).toThrow();
    });

    it('checks text and conversion signatures including positional captures', () => {
        for (const [expression, expected] of [
            ['65 character', 'text'], ['"A" codepoint', 'integer'], ['("A" bytes) hex', 'text'],
            ['"12" integer', 'integer'], ['"1.5" real', 'real'], ['3 text', 'text'],
            ['(array 65 66) bytes', 'bytes'], ['("A" bytes) bytes', 'bytes'],
            ['(array 1 2) "," join', 'text'], ['(1 to 3) "," join', 'text'],
            ['"12 blue" "/integer /word" parse', 'tuple'], ['"12 13" "/integer /integer" parse', 'array'],
            ['"a b" words', 'array'], ['(array "a b" "a c") 2 vocab', 'array'],
            ['"ABC" lower', 'text'], ['(array "ABC" "DEF") lower', 'array'],
            ['"abc" len', 'integer'], ['(tuple 1 "a") len', 'integer'],
        ]) expect(typeName(new Interpreter().execute('use text\n' + expression)!), expression).toBe(expected);
        expect(() => new Interpreter().execute('use text\n.NA text')).toThrow();
        expect(() => new Interpreter().execute('use dates\n(1 duration) text')).toThrow();
        expect(() => new Interpreter().execute('use text\n(array .NA) "," join')).toThrow();
        expect(() => new Interpreter().execute('use text\n"ab" codepoint')).toThrow();
    });

    it('checks queue-family aliases and length domains against runtime representations', () => {
        for (const name of ['queue', 'stack', 'deque']) {
            const initialize = `use algo\nuse text\nS = new ${name}\nS push 2\nS push 3\n`;
            for (const expression of ['S sum', 'S min', 'S max', 'S len']) {
                expect(typeName(new Interpreter().execute(initialize + expression)!), name + expression).toBe('integer');
            }
            expect(typeName(new Interpreter().execute(initialize + 'S "," join')!), name).toBe('text');
        }
        expect(typeName(new Interpreter().execute('("ab" bytes) len')!)).toBe('integer');
        expect(() => new Interpreter().execute('use algo\nI = new index\nI len')).toThrow();
    });

    it('checks linear algebra result forms, including empty real determinants', () => {
        for (const [expression, expected] of [
            ['(array 1 2) diag', 'array'], ['(array 1 2) (array 3 4) matmul', 'integer'],
            ['(array 1.0 2.0) (array 3.0 4.0) matmul', 'real'],
            ['((array 1 2) diag) (array 3 4) matmul', 'array'],
            ['((array 1 2) diag) det', 'integer'], ['((array 1.0 2.0) diag) det', 'real'],
            ['(array shape 0 0 fill 0.0) det', 'integer'],
            ['((array 1 2) diag) inverse', 'array'], ['((array 1 2) diag) eigh', 'tuple'],
            ['((array 1 2) diag) (array 3 4) solve', 'array'],
        ]) expect(typeName(new Interpreter().execute('use linalg\n' + expression)!), expression).toBe(expected);
    });

    it('checks statistical reductions, quantile arrays and general mode results', () => {
        for (const name of ['mean', 'median', 'std', 'variance', 'var', 'skewness', 'skew', 'quantile', 'percentile']) {
            expect(typeName(new Interpreter().execute(`use stats\n(array 1 2 3) ${name}`)!), name).toBe('real');
            expect(typeName(new Interpreter().execute(`use stats\n3 ${name}`)!), name).toBe('real');
        }
        for (const [expression, expected] of [
            ['(array 1 2 3) (array 0.25 0.75) quantile', 'array'],
            ['(array 1 2 3) (array 25 75) percentile', 'array'],
            ['(array shape 2 3 fill 1) covariance', 'array'],
            ['(array shape 2 3 fill 1) correlation', 'array'], ['(array shape 2 3 fill 1) corr', 'array'],
            ['(array 1 2) (array 2 3) mse', 'real'], ['1 2 mae', 'real'],
            ['(array "a" "b" "a") mode', 'text'], ['"abc" mode', 'text'],
        ]) expect(typeName(new Interpreter().execute('use stats\n' + expression)!), expression).toBe(expected);
        expect(() => new Interpreter().execute('use algo\nuse stats\nQ = new queue\nQ push 1\nQ mean')).toThrow();
    });

    it('validates shape contracts against explicit ranks and representation facts', () => {
        for (const entry of operations) {
            if (entry.monadicRank !== undefined || entry.dyadicRanks
                || entry.denseElements || entry.preservesCollectionElements) {
                expect(entry.shape, entry.name).toBeDefined();
            }
            const arities = entry.shape?.map(signature => signature.args.length) ?? [];
            if (entry.monadicRank !== undefined) expect(arities, entry.name).toContain(1);
            if (entry.dyadicRanks) expect(arities, entry.name).toContain(2);
            expect(new Set(arities).size, entry.name).toBe(arities.length);
            for (const signature of entry.shape ?? []) {
                expect(validateShapeSignature(signature), entry.name).toEqual([]);
                expect(entry.arities, entry.name).toContain(signature.args.length);
                const ranks = signature.args.length === 1 ? [entry.monadicRank ?? 'all'] : entry.dyadicRanks;
                signature.args.forEach((arg, i) => {
                    if (arg && !arg.some(term => term !== null && typeof term === 'object' && 'spread' in term)
                        && typeof ranks?.[i] === 'number') expect(arg.length, entry.name).toBe(ranks[i]);
                });

            }
        }
    });

    it('keeps direct compiled-call profiles consistent with the operation contract', () => {
        for (const entry of operations) {
            const signature = entry.compiledCall;
            if (!signature) continue;
            expect(entry.arities, entry.name).toContain(signature.inputs.length);
            const results = resultTypes(entry);
            if (results.length) expect(results, entry.name).toContain(signature.result);
            expect(entry.effects ?? [], entry.name).toEqual([]);
            expect(entry.lazy, entry.name).toBeUndefined();
            expect(signature.inputs[0], entry.name).not.toBe('same');
            expect(signature.callbacks, entry.name).toBe(signature.inputs.includes('text-array') ? 'read-cells' : 'none');
            expect(signature.cost, entry.name).toBe(signature.hostFunction ? 'host-dependent' : 'input-dependent');
        }
    });

    it('verifies every compiled profile against real calls, including Unicode and bytes', () => {
        const examples: Record<string, string[]> = {
            text: ['0', '(-123)', '9007199254740993'],
            reverse: ['""', '"😀é"'], len: ['""', '"😀é"', '(array 1 2)', '(array shape 0 fill 0)', '(array shape 2 3 fill 0)'],
            bytes: ['"ёж"', '("ёж" bytes)'],
            md5: ['"abc"', '("abc" bytes)'],
            startswith: ['"ёж" "ё"', '("ёж" bytes) ("ё" bytes)'],
            lower: ['"ЁЖ"'], codepoint: ['"😀"'], character: ['128512'],
            join: ['(array "ёж" "😀") ":"'],
        };
        const profiles = operations.filter(entry => entry.compiledCall);
        // A new eligibility entry needs an actual runtime example as well.
        expect(profiles.map(entry => entry.name).sort()).toEqual(Object.keys(examples).sort());
        for (const entry of profiles) for (const operands of examples[entry.name]) {
            const runtime = new Interpreter();
            try {
                const value = runtime.execute(`use text\nuse crypto\nuse sequences\n${operands} ${entry.name}`)!;
                expect(typeName(value), `${entry.name}: ${operands}`).toBe(entry.compiledCall!.result);
            } finally { runtime.dispose(); }
        }
    });

    it('does not make narrower compiler inputs into language restrictions', () => {
        const runtime = new Interpreter();
        try {
            expect(typeName(runtime.execute('(array 65 66) bytes')!)).toBe('bytes');
            expect(runtime.execute('use text\n(array 1 2) ":" join')).toBe('1:2');
            const lifted = runtime.execute('(array "a" "b") "a" startswith')!;
            expect(typeName(lifted)).toBe('array');
        } finally { runtime.dispose(); }
    });

    it('names a module that exists for every entry', () => {
        const known = new Set(modules.map(module => module.name));
        expect(Object.keys(standardModules).sort()).toEqual([...known].sort());
        const orphans = [...operations, ...moduleForms]
            .filter(entry => !known.has(entry.module))
            .map(entry => entry.module);
        expect(orphans).toEqual([]);
    });

    it('writes each form data-first, with the name after its operands', () => {
        const wrong = operations.filter(entry => {
            const words = entry.form.split(' ');
            const at = words.indexOf(entry.name);
            if (at < 0) return true;
            // A value stands alone; an operation follows the data it reads.
            return entry.arities.length === 0 ? words.length !== 1 : at === 0;
        });
        expect(wrong.map(entry => entry.form)).toEqual([]);
    });

    it('gives every standard-library operation a unique name', () => {
        const names = operations.map(operation => operation.name);
        expect(new Set(names).size).toBe(names.length);
        expect(findOperation('find')?.module).toBe('sequences');
        expect(findOperation('findroot')?.module).toBe('graph');
        expect(findOperation('findroot')?.result).toBe('element');
    });

    it('finds an entry by name', () => {
        expect(findOperation('dijkstra')?.module).toBe('graph');
        expect(findOperation('dijkstra')?.form).toBe('Graph Start dijkstra');
        expect(findOperation('nosuchname')).toBeUndefined();
    });
});

describe('the forms a use enables', () => {
    it.each(moduleForms.filter(form => form.module === 'core'))('provides $form without imports', form => {
        expect(errorOf(form.example)).toBeUndefined();
    });
    it.each(moduleForms.filter(form => form.module !== 'core'))('gates $form behind use $module', form => {
        expect(gateMessage(form.example)).toBe(`use ${form.module}`);
        // With the module the example must simply run. Checking only that the
        // gate is gone would let a broken example stand.
        expect(errorOf(`use ${form.module}\n${form.example}`)).toBeUndefined();
    });
});

/** The error a source raises, or undefined when it runs. */
function errorOf(source: string): string | undefined {
    try {
        new Interpreter(() => undefined, { input: new TokenInput(['1']) }).execute(source);
        return undefined;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/**
 * The module a source refuses to run without, or undefined when it needs none.
 * A gated construct says `requires: use X`; a gated name is simply unknown and
 * the runtime suggests the module that would define it.
 */
function gateMessage(source: string): string | undefined {
    const message = errorOf(source);
    if (message === undefined) return undefined;
    return /requires: (use \w+)|did you forget `(use \w+)`/.exec(message)?.slice(1)
        .find(group => group !== undefined);
}

function catalogueKeys(): Set<string> {
    const keys = new Set<string>();
    for (const entry of operations) {
        const key = `${entry.module}.${entry.name}`;
        if (keys.has(key)) throw new Error(`duplicate catalogue entry: ${key}`);
        keys.add(key);
    }
    return keys;
}
