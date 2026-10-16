import type { CompiledFunctionType, CompiledScalarType } from '@arrrank/language';
import type { RankValue } from './value.js';

/** A proven call boundary; bind rechecks closure and builtin identities at region entry. */
export interface CompiledCallee {
    readonly parameters: readonly CompiledFunctionType[];
    readonly type: CompiledScalarType;
    readonly locals: readonly string[];
    readonly effects: {
        readonly writes: readonly number[];
        readonly stableArrayReads: boolean;
    };
    bind(): ((arguments_: RankValue[], tail?: boolean) => RankValue) | undefined;
}
