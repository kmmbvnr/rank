import { findOperation, matchCompiledCallSignature } from '@arrrank/language';
import { isPureHostFunction } from './host-effects.js';
import type { InterpreterOptions } from './interpreter-options.js';
import type { BuiltinRegistry } from './modules/builtins.js';
import { interruptsEnabled } from './interrupt.js';
import { isNativeFunction, type NativeFunction, type RankValue } from './value.js';

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
export function typedNativeCall(value: NativeFunction, signature: string): Call {
    if (interruptsEnabled()) return value.call;
    const calls = implementations.get(value);
    return calls && Object.prototype.hasOwnProperty.call(calls, signature) ? calls[signature] : value.call;
}

interface BuiltinHost {
    readonly modules: ReadonlySet<string>;
    readonly builtins: Pick<BuiltinRegistry, 'is'>;
    resolve(name: string): RankValue;
    options(): InterpreterOptions;
}

/** Prepare the proven input signature once; resolve the owner's current binding
 * at each region entry. Preparation does not read bindings or call user code. */
export function prepareCompiledBuiltin(
    host: BuiltinHost, module: string, name: string, types: readonly string[],
): () => Call | undefined {
    const operation = findOperation(name);
    if (!operation || operation.module !== module || operation.effects?.length) return () => undefined;
    const profile = matchCompiledCallSignature(operation, types);
    if (!profile) return () => undefined;
    const signature = types.join(',');
    return () => {
        if (!host.modules.has(module)) return undefined;
        const options = host.options();
        // Unknown host callbacks may mutate bindings or re-enter Rank.
        const override = profile.hostFunction && options[profile.hostFunction];
        if (override && !isPureHostFunction(override)) return undefined;
        try {
            const value = host.resolve(name);
            return isNativeFunction(value) && host.builtins.is(module, name, value)
                ? options.typedNativeCalls === false ? value.call : typedNativeCall(value, signature)
                : undefined;
        } catch { return undefined; }
    };
}
