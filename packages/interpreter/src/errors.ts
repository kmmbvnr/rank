import type { RankErrorValue, RankValue } from './value.js';

export class RankError extends Error {
    constructor(
        message: string,
        readonly rankKind = 'Runtime',
        readonly value?: RankValue,
        private cause?: RankError,
    ) {
        super(message);
        this.name = 'RankError';
    }

    toValue(): RankErrorValue {
        return {
            kind: 'error',
            errorKind: { kind: 'label', name: this.rankKind },
            message: this.message,
            value: this.value,
            trace: this.stack ?? this.message,
            cause: this.cause?.toValue(),
            source: this,
        };
    }

    attachCause(cause: RankError): void {
        if (this.cause) {
            this.cause.attachCause(cause);
        } else {
            this.cause = cause;
        }
    }
}

export class MissingValueError extends RankError {
    constructor(message: string) {
        super(message, 'Missing');
        this.name = 'MissingValueError';
    }
}
