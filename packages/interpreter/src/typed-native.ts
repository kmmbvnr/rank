import { interruptsEnabled } from './interrupt.js';
import type { NativeFunction, RankValue } from './value.js';

type Call = (arguments_: RankValue[]) => RankValue;
const implementations = new WeakMap<NativeFunction, Readonly<Record<string, Call>>>();

/** Internal kernels, keyed by the complete comma-separated input signature.
 * The loop compiler must prove every input type and arity before selecting one.
 * Registration does not establish purity or authorize compilation by itself. */
export function withTypedCalls(value: NativeFunction, calls: Readonly<Record<string, Call>>): NativeFunction {
    implementations.set(value, calls);
    return value;
}

/** Bind at each region entry. Interactive execution keeps all native boundary
 * checks; kernels run only in regions that cannot re-enter Rank or change effects. */
export function typedNativeCall(value: NativeFunction, types: readonly string[]): Call {
    if (interruptsEnabled()) return value.call;
    const calls = implementations.get(value), signature = types.join(',');
    return calls && Object.prototype.hasOwnProperty.call(calls, signature) ? calls[signature] : value.call;
}
