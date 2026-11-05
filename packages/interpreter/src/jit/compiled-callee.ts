import type { CompiledFunctionType } from '@arrrank/language';
import type { CompiledCalleeType } from './compiled-callee-type.js';
import type { LoopCallable, LoopWorkCounter } from './integer-loop-plan.js';

/** A proven call boundary; bind rechecks closure and builtin identities at region entry. */
export interface CompiledCallee {
    readonly parameters: readonly CompiledCalleeType[];
    readonly type: CompiledFunctionType;
    readonly locals: readonly string[];
    readonly effects: {
        readonly writes: readonly number[];
        readonly stableArrayReads: boolean;
        readonly localWrites?: boolean;
        readonly privateStateSafe: boolean;
    };
    readonly numberSafe?: boolean;
    /** A fresh pointwise result using the private Number-array ABI. */
    readonly numberArrayResult?: boolean;
    bind(work?: LoopWorkCounter): LoopCallable | undefined;
    bindNumber?(work?: LoopWorkCounter): LoopCallable | undefined;
}
