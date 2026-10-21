import { BuiltinRegistry } from './modules/builtins.js';
import { noteArrayBinding } from './array-storage.js';
import { isRankArray, type NativeFunction, type RankValue } from './value.js';

export function snapshotLazyOperand(value: RankValue): RankValue {
    if (isRankArray(value)) noteArrayBinding(value);
    return value;
}

export function isPureLazyFunction(fn: NativeFunction): boolean {
    const builtin = BuiltinRegistry.operationOf(fn);
    return builtin ? !builtin.effects?.length && (fn.lazySafe?.() ?? true) : !!fn.lazySafe?.();
}

/** Bind dependencies without restricting observable effects. A later demand
 * may invoke the callback again; purity remains an optimization proof only. */
export function snapshotLazyFunction(fn: NativeFunction): NativeFunction {
    return fn.snapshot?.() ?? fn;
}
