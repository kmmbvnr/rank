import { findOperation, matchCompiledCallSignature } from '@arrrank/language';
import { isPureHostFunction } from './host-effects.js';
import type { InterpreterOptions } from './interpreter-options.js';
import type { BuiltinRegistry } from './modules/builtins.js';
import { interruptsEnabled } from './interrupt.js';
import { isNativeFunction, type NativeFunction, type RankValue } from './value.js';

type Call = (arguments_: RankValue[]) => RankValue;
/** Positional Number kernel: compiled call sites pass registers, not an array. */
type NumberCall = (...arguments_: number[]) => number | bigint | boolean;
/** A positional call slot for generated code; see `preparePositionalBuiltin`. */
export type PositionalCall = (...arguments_: never[]) => RankValue;
const numberImplementations = new WeakMap<NativeFunction, Readonly<Record<string, NumberCall>>>();

/** Exact kernels over Number registers; wide integer results trigger private replay.
 * Registration never bypasses catalogue or entry guards. */
export function withNumberCalls(value: NativeFunction, calls: Readonly<Record<string, NumberCall>>): NativeFunction {
    numberImplementations.set(value, calls);
    return value;
}

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

interface BoundBuiltin {
    readonly call: Call;
    /** Present only when typed calls are enabled outside an interrupt scope. */
    readonly kernel?: NumberCall;
}

/** Shared entry guard for both calling conventions. */
function prepareBuiltinBinding(host: BuiltinHost, module: string, name: string, types: readonly string[]) {
    const operation = findOperation(name);
    if (!operation || operation.module !== module || operation.effects?.length) return undefined;
    const profile = matchCompiledCallSignature(operation, types);
    if (!profile) return undefined;
    const signature = types.join(',');
    const bind = (): BoundBuiltin | undefined => {
        if (!host.modules.has(module)) return undefined;
        const options = host.options();
        // Unknown host callbacks may mutate bindings or re-enter Rank.
        const override = profile.hostFunction && options[profile.hostFunction];
        if (override && !isPureHostFunction(override)) return undefined;
        try {
            const value = host.resolve(name);
            if (!isNativeFunction(value) || !host.builtins.is(module, name, value)) return undefined;
            const typed = options.typedNativeCalls !== false;
            return {
                call: typed ? typedNativeCall(value, signature) : value.call,
                kernel: typed && !interruptsEnabled() ? numberImplementations.get(value)?.[signature] : undefined,
            };
        } catch { return undefined; }
    };
    return { bind, integerResult: profile.result === 'integer' };
}

/** Prepare the proven input signature once; resolve the owner's current binding
 * at each region entry. Preparation does not read bindings or call user code. */
export function prepareCompiledBuiltin(
    host: BuiltinHost, module: string, name: string, types: readonly string[], numberMode = false,
): () => Call | undefined {
    const prepared = prepareBuiltinBinding(host, module, name, types);
    if (!prepared) return () => undefined;
    return () => {
        const bound = prepared.bind();
        if (!bound || !numberMode) return bound?.call;
        const { call, kernel } = bound;
        if (kernel) return arguments_ => kernel(...arguments_ as number[]);
        // The catalogue proves scalar domains and absence of callbacks.
        // Convert only integer registers; the caller checks integer results
        // and discards its private attempt if they exceed safe Number range.
        return arguments_ => {
            const result = call(arguments_.map((value, index) => types[index] === 'integer' ? BigInt(value as number) : value));
            return prepared.integerResult ? Number(result) : result;
        };
    };
}

/** The same guarded binding as `prepareCompiledBuiltin`, with a positional
 * convention: `call(a, b)` rather than `call([a, b])`. A registered Number
 * kernel is returned as is; other calls allocate their argument array only
 * where the generic native boundary requires one. */
export function preparePositionalBuiltin(
    host: BuiltinHost, module: string, name: string, types: readonly string[], numberMode = false,
): () => PositionalCall | undefined {
    const prepared = prepareBuiltinBinding(host, module, name, types);
    if (!prepared) return () => undefined;
    const arity = types.length;
    const widen = types.map(type => numberMode && type === 'integer');
    const integerResult = numberMode && prepared.integerResult;
    return () => {
        const bound = prepared.bind();
        if (!bound) return undefined;
        if (numberMode && bound.kernel) return bound.kernel as PositionalCall;
        const { call } = bound;
        const narrow = integerResult ? (value: RankValue) => Number(value) : (value: RankValue) => value;
        const input = (value: RankValue, index: number) => widen[index] ? BigInt(value as number) : value;
        if (arity === 1) return ((a: RankValue) => narrow(call([input(a, 0)]))) as PositionalCall;
        if (arity === 2) return ((a: RankValue, b: RankValue) => narrow(call([input(a, 0), input(b, 1)]))) as PositionalCall;
        if (arity === 3) return ((a: RankValue, b: RankValue, c: RankValue) =>
            narrow(call([input(a, 0), input(b, 1), input(c, 2)]))) as PositionalCall;
        return ((...arguments_: RankValue[]) => narrow(call(arguments_.map(input)))) as PositionalCall;
    };
}
