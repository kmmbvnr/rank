export class RankError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RankError';
    }
}
