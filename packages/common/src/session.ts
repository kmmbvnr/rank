import {
    Interpreter,
    type InterpreterOptions,
    type RankValue,
} from '@arrrank/interpreter';

export type RankOutput = (text: string) => void;

/** Owns one persistent interpreter shared by application shells. */
export class RankSession {
    readonly interpreter: Interpreter;
    private disposed = false;

    constructor(output: RankOutput, options: InterpreterOptions = {}) {
        this.interpreter = new Interpreter(output, options);
    }

    execute(source: string): RankValue | undefined {
        if (this.disposed) throw new Error('Rank session is disposed');
        return this.interpreter.execute(source);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.interpreter.dispose();
    }
}

/** Runs an isolated program and always releases its runtime resources. */
export function runProgram(
    source: string,
    output: RankOutput,
    options: InterpreterOptions = {},
): RankValue | undefined {
    const session = new RankSession(output, options);
    try {
        return session.execute(source);
    } finally {
        session.dispose();
    }
}
