import { describe, expect, it } from 'vitest';
import {
    findOperation, resultTypes, validateShapeSignature, moduleForms, modules, operations, type Operation,
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
            reverse: ['""', '"😀é"'], len: ['""', '"😀é"'],
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
