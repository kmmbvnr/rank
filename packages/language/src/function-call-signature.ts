import type { FunctionStatement } from './generated/ast.js';

export interface CallParameter {
    readonly name: string;
    readonly index: number;
    /** Lowercase parameters may receive functions; they are not restricted to functions. */
    readonly acceptsFunction: boolean;
}

/** The declaration's calling convention, separate from inferred argument/result types. */
export interface FunctionCallSignature {
    readonly parameters: readonly CallParameter[];
    readonly arity: number;
}

const signatures = new WeakMap<FunctionStatement, FunctionCallSignature>();

export function functionCallSignature(statement: FunctionStatement): FunctionCallSignature {
    let signature = signatures.get(statement);
    if (!signature) {
        const parameters = statement.parameters.map((name, index) => ({
            name, index, acceptsFunction: !/^[A-Z]/.test(name),
        }));
        signature = { parameters, arity: parameters.length };
        signatures.set(statement, signature);
    }
    return signature;
}
