import { findOperation, type Operation } from '@arrrank/language';
import { RankError } from '../errors.js';
import {
    formatValue, isNativeFunction, isRankErrorValue, isRankLabel, isRankSequence, typeName,
    type NativeFunction, type RankSequence, type RankValue,
} from '../value.js';
import { standardModules } from './index.js';
import { randomFromSeed } from './random.js';
import type { RuntimeContext, RuntimeModule } from './types.js';

// The catalogue entry each builtin instance came from, so a renamed binding
// keeps its identity for form classification.
const builtinOperations = new WeakMap<NativeFunction, Operation>();

const raiseFunction: NativeFunction = {
    kind: 'function',
    name: 'raise',
    arities: [1, 2],
    monadicRank: 'all',
    call(arguments_) {
        const first = arguments_[0];
        if (arguments_.length === 1 && isRankErrorValue(first)) {
            if (first.source instanceof RankError) throw first.source;
            throw new RankError(first.message, first.errorKind.name, first.value);
        }
        if (!isRankLabel(first)) {
            throw new RankError('raise expects an error or a label followed by an optional value');
        }
        const value = arguments_[1];
        const message = value === undefined
            ? `.${first.name}`
            : typeof value === 'string'
                ? value
                : `.${first.name}: ${formatValue(value)}`;
        throw new RankError(message, first.name, value);
    },
};

const typeFunction: NativeFunction = {
    kind: 'function',
    name: 'type',
    arities: [1],
    monadicRank: 'all',
    call: arguments_ => ({ kind: 'label', name: typeName(arguments_[0]) }),
};

/**
 * The builtins one interpreter has opened. Each standard definition is
 * instantiated once per interpreter on first use, so identity comparisons
 * (`is`) tell a standard function from a user binding of the same name.
 * Adding a builtin touches its module and `operations.ts`, never this file.
 */
export class BuiltinRegistry {
    /** Instances by definition, shared with the reduction and rank owners. */
    readonly functions = new Map<RuntimeModule[string], NativeFunction>();
    private readonly sequences = new Map<RuntimeModule[string], RankSequence>();

    constructor(
        private readonly modules: ReadonlySet<string>,
        private readonly context: RuntimeContext,
    ) {}

    /** The catalogue entry a builtin instance came from; undefined for user functions. */
    static operationOf(fn: NativeFunction): Operation | undefined {
        return builtinOperations.get(fn);
    }

    /** What a name means among the open modules, or undefined when none defines it. */
    lookup(name: string): RankValue | undefined {
        if (name === 'raise') return raiseFunction;
        if (name === 'type') return typeFunction;
        for (const module of this.modules) {
            const fn = standardModules[module]?.[name];
            if (fn) {
                const cached = this.functions.get(fn) ?? this.sequences.get(fn);
                if (cached !== undefined) return cached;
                const value = fn(this.context);
                if (isNativeFunction(value)) {
                    this.functions.set(fn, value);
                    const operation = findOperation(name);
                    if (operation) builtinOperations.set(value, operation);
                }
                if (isRankSequence(value)) this.sequences.set(fn, value);
                return value;
            }
        }
        return undefined;
    }

    /** The instance of a standard function, once this interpreter has created it. */
    standard(module: string, name: string): NativeFunction | undefined {
        const definition = standardModules[module]?.[name];
        return definition === undefined ? undefined : this.functions.get(definition);
    }

    /** Whether a value is this interpreter's instance of a standard function. */
    is(module: string, name: string, value: RankValue): boolean {
        const instance = this.standard(module, name);
        return instance !== undefined && instance === value;
    }

    /** The error for a name nothing defines, naming the `use` that would. */
    unknown(name: string): RankError {
        const providers = Object.entries(standardModules)
            .filter(([module, exports]) => !this.modules.has(module) && Object.prototype.hasOwnProperty.call(exports, name))
            .map(([module]) => `use ${module}`);
        const hint = providers.length > 0
            ? `; did you forget ${providers.map(provider => `\`${provider}\``).join(' or ')}?`
            : '';
        return new RankError(name === 'scan' && !hint
            ? 'scan needs an operator, e.g. Range scan + with 0'
            : `unknown name: ${name}${hint}`);
    }
}

const SEED_RANDOM = Symbol('seedRandom');

/** A random source that `random seed` can reseed; module children share it. */
export type SeedableRandom = (() => number) & {
    readonly [SEED_RANDOM]: (seed: bigint) => void;
};

export function seedableRandom(source?: () => number): SeedableRandom {
    if (source && SEED_RANDOM in source) return source as SeedableRandom;

    let next = source ?? Math.random;
    const random = (() => next()) as SeedableRandom;
    Object.defineProperty(random, SEED_RANDOM, {
        value(seed: bigint) {
            next = randomFromSeed(seed);
        },
    });
    return random;
}

export function reseed(random: SeedableRandom, seed: bigint): void {
    random[SEED_RANDOM](seed);
}
