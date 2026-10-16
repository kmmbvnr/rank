import type { CompiledScalarType } from '@arrrank/language';
import type { CompiledCalleeType } from './compiled-callee-type.js';
import type { RankValue } from './value.js';

/** A proven call boundary; bind rechecks closure and builtin identities at region entry. */
export interface CompiledCallee {
    readonly parameters: readonly CompiledCalleeType[];
    readonly type: CompiledScalarType;
    readonly locals: readonly string[];
    readonly effects: {
        readonly writes: readonly number[];
        readonly stableArrayReads: boolean;
    };
    bind(): ((arguments_: RankValue[], tail?: boolean) => RankValue) | undefined;
}
