import { describe, expect, it } from 'vitest';
import {
    findOperation, moduleForms, modules, operations, type Operation,
} from '@rank/language';
import { Interpreter, standardModules } from '../src/index.js';
import type { RuntimeContext } from '../src/modules/types.js';
import { isNativeFunction, type RankValue } from '../src/value.js';
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

    it('finds an entry by name', () => {
        expect(findOperation('dijkstra')?.module).toBe('graph');
        expect(findOperation('dijkstra')?.form).toBe('Graph Start dijkstra');
        expect(findOperation('nosuchname')).toBeUndefined();
    });
});

describe('the forms a use enables', () => {
    it.each(moduleForms)('gates $form behind use $module', form => {
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
