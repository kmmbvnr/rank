import type { BaseParser, IRecognitionException, IToken } from 'chevrotain';
import { LLStarLookaheadStrategy } from 'chevrotain-allstar';

/** ALL(*) normally discards the token where prediction failed and reports its starting point. */
export class ErrorLookaheadStrategy extends LLStarLookaheadStrategy {
    diagnosing = false;
    readonly failures = new Map<number, IToken>();

    override buildLookaheadForAlternation(options: Parameters<LLStarLookaheadStrategy['buildLookaheadForAlternation']>[0]) {
        return this.track(super.buildLookaheadForAlternation(options));
    }

    override buildLookaheadForOptional(options: Parameters<LLStarLookaheadStrategy['buildLookaheadForOptional']>[0]) {
        return this.track(super.buildLookaheadForOptional(options));
    }

    private track<A extends unknown[], R>(predict: (this: BaseParser, ...args: A) => R) {
        const strategy = this;
        return function (this: BaseParser, ...args: A): R {
            if (!strategy.diagnosing) return predict.apply(this, args);
            // ALL(*) uses LA_FAST for its first token and LA for subsequent tokens.
            // Only instrument the diagnostic replay; normal parsing keeps its fast path.
            const reader = this as unknown as { LA(distance: number): IToken };
            const look = reader.LA;
            let distance = 1;
            reader.LA = function (ahead) {
                distance = Math.max(distance, ahead);
                return look.call(this, ahead);
            };
            try {
                const result = predict.apply(this, args);
                if ((result === undefined || result === false) && distance > 1) {
                    let token = look.call(this, distance);
                    const previous = look.call(this, distance - 1);
                    // An unfinished expression before a block boundary belongs to the
                    // preceding line, not to the otherwise valid closing keyword.
                    if (['end', 'else', 'elif', 'catch', 'finally'].includes(token.image)
                        && previous.tokenType.name === 'NL') token = previous;
                    let first = 1;
                    while (first < distance && look.call(this, first).tokenType.name === 'NL') first++;
                    const offset = look.call(this, first).startOffset;
                    const existing = strategy.failures.get(offset);
                    if (!existing || (token.startOffset ?? Infinity) > existing.startOffset) {
                        strategy.failures.set(offset, token);
                    }
                }
                return result;
            } finally {
                reader.LA = look;
            }
        };
    }

    locate(error: IRecognitionException, source: string): void {
        // Preserve precise errors inside a statement (including spelling hints).
        // Only relocate an error that points at the beginning of a source line.
        const offset = error.token.startOffset;
        const prefix = source.slice(source.lastIndexOf('\n', offset - 1) + 1, offset);
        if (!/^\s*$/.test(prefix)) return;
        const token = this.failures.get(error.token.startOffset);
        if (token && token.startOffset > offset) {
            error.token = token;
            error.message = token.tokenType.name === 'NL' ? 'Unexpected end of line' : `Unexpected '${token.image}'`;
        }
    }
}
