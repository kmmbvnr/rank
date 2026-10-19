import { RankError } from './errors.js';
import { BuiltinRegistry } from './modules/builtins.js';
import { isFlatScalarArray, noteArrayBinding } from './array-storage.js';
import { isRankDate, isRankLabel, MISSING, type NativeFunction, type RankValue } from './value.js';

export function snapshotLazyOperand(value: RankValue): RankValue {
    if (typeof value === 'object' && value !== MISSING && !isRankDate(value) && !isRankLabel(value)) {
        if (!isFlatScalarArray(value)) throw new RankError('lazy configuration requires scalar values or materialized scalar arrays', 'Scope');
        noteArrayBinding(value);
    }
    return value;
}

export function isPureLazyFunction(fn: NativeFunction): boolean {
    const builtin = BuiltinRegistry.operationOf(fn);
    return builtin ? !builtin.effects?.length && (fn.lazySafe?.() ?? true) : !!fn.lazySafe?.();
}

/** Freeze dependencies before proving an operation safe for deferred reuse.
 * Builtins are recognized by registry identity, never by a user-visible name. */
export function pureLazyFunction(fn: NativeFunction): NativeFunction {
    const frozen = fn.snapshot?.() ?? fn;
    if (!isPureLazyFunction(frozen)) {
        throw new RankError(`lazy callback ${fn.name} must be pure; input mutation, external effects and unresolved callbacks are not supported`, 'Scope');
    }
    return frozen;
}
