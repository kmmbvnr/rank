import { RankError } from './errors.js';
import { BuiltinRegistry } from './modules/builtins.js';
import type { NativeFunction } from './value.js';

/** Freeze dependencies before proving an operation safe for deferred reuse.
 * Builtins are recognized by registry identity, never by a user-visible name. */
export function pureLazyFunction(fn: NativeFunction): NativeFunction {
    const frozen = fn.snapshot?.() ?? fn;
    const builtin = BuiltinRegistry.operationOf(frozen);
    if (!(builtin ? !builtin.effects?.length && (frozen.lazySafe?.() ?? true) : frozen.lazySafe?.())) {
        throw new RankError(`lazy callback ${fn.name} must be pure; external effects and unresolved callbacks are not supported`, 'Scope');
    }
    return frozen;
}
