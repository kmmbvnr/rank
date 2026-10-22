import type { NativeFunction } from './value.js';

// A host may replace a published function's call property. Identity alone
// must not authorize speculative evaluation of that replacement.
const implementations = new WeakMap<NativeFunction, NativeFunction['call']>();

export function registerNativeImplementation(fn: NativeFunction): NativeFunction {
    if (!implementations.has(fn)) implementations.set(fn, fn.call);
    return fn;
}

export function hasNativeImplementation(fn: NativeFunction): boolean {
    return implementations.get(fn) === fn.call;
}
