export class RankError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RankError';
    }
}

export class MissingValueError extends RankError {
    constructor(message: string) {
        super(message);
        this.name = 'MissingValueError';
    }
}
