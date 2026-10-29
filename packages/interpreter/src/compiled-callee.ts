import type { CompiledFunctionType } from '@arrrank/language';
import type { CompiledCalleeType } from './compiled-callee-type.js';
import type { LoopCallable } from './integer-loop-plan.js';

/** A proven call boundary; bind rechecks closure and builtin identities at region entry. */
export interface CompiledCallee {
    readonly parameters: readonly CompiledCalleeType[];
    readonly type: CompiledFunctionType;
    readonly locals: readonly string[];
    readonly effects: {
        readonly writes: readonly number[];
        readonly stableArrayReads: boolean;
    };
    readonly numberSafe?: boolean;
    bind(): LoopCallable | undefined;
    bindNumber?(): LoopCallable | undefined;
}
