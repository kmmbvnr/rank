import type { RankValue } from './value.js';

/**
 * Non-local exits that unwind the JavaScript stack. Each signal has one
 * catcher: a return or tail call ends at the function call loop, a jump at its
 * enclosing loop. Ordinary loop jumps avoid throwing by setting
 * `LoopControl.signal` instead; these remain for protected blocks and for
 * execution with `directLoopControl` disabled.
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
        readonly compiled?: (arguments_: RankValue[], tail: boolean) => RankValue) {}
}

export class BreakSignal {}
export class ContinueSignal {}

// The signals carry nothing, so one of each serves every loop.
export const BREAK_SIGNAL = new BreakSignal();
export const CONTINUE_SIGNAL = new ContinueSignal();
