import type { CallRequirement } from '@arrrank/language';
import type { RankValue } from './value.js';

/** A prepared scalar body whose native bindings, if any, need entry validation. */
export type PreparedScalarCall = ((arguments_: RankValue[], tail?: boolean) => RankValue) & {
    readonly available?: () => boolean;
    direct?: (...arguments_: RankValue[]) => RankValue;
    numberDirect?: (...arguments_: number[]) => number;
};

/**
 * Non-local exits that unwind the JavaScript stack. Each signal has one
 * catcher: a return or tail call ends at the function call loop, a jump at its
 * enclosing loop. Ordinary returns and jumps use their execution carriers.
 * Signals remain for protected blocks, compiled transfers and execution with
 * direct control disabled.
 */

/** A `return`, caught by the call that owns the frame. A generator returns without a value. */
export class ReturnSignal {
    constructor(readonly value?: RankValue) {}
}

/**
 * A call in tail position. The active call loop replaces its frame with the
 * callee's instead of growing the stack; `compiled` is a proven scalar body
 * that needs no frame at all.
 */
export class TailCallSignal<Definition> {
    constructor(readonly definition: Definition, readonly arguments_: RankValue[],
        readonly compiled?: PreparedScalarCall, readonly inputRequirement?: CallRequirement) {}
}

export class BreakSignal {}
export class ContinueSignal {}

// The signals carry nothing, so one of each serves every loop.
export const BREAK_SIGNAL = new BreakSignal();
export const CONTINUE_SIGNAL = new ContinueSignal();

/** Ordinary blocks pass completed returns to their owning function driver.
 * Protected blocks omit this carrier and retain exception unwinding. */
export interface FunctionControl<Definition = unknown> {
    returned?: boolean;
    value?: RankValue;
    tail?: TailCallSignal<Definition>;
}

export function returnFunctionValue(control: FunctionControl | undefined, value?: RankValue): undefined {
    if (!control) throw new ReturnSignal(value);
    // A tail expression has already installed its transfer before completing.
    if (!control.returned) {
        control.returned = true;
        control.value = value;
    }
    return undefined;
}
