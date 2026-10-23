import type { Expression, FunctionStatement } from './generated/ast.js';

export interface CallParameter {
    readonly name: string;
    readonly index: number;
    /** Keep an argument plan at function entry instead of materializing it. */
    readonly deferred: boolean;
    readonly acceptsFunction: boolean;
    readonly kind: 'data' | 'function' | 'option';
}

export interface CallWord {
    readonly word: string;
    readonly parameter: number;
    readonly defaultValue?: Expression;
}

/** Syntax belongs to a declaration; inferred argument/result types remain separate. */
export interface FunctionCallSignature {
    readonly parameters: readonly CallParameter[];
    readonly arity: number;
    readonly leftCount: number;
    readonly rightParameters: readonly CallParameter[];
    readonly words: readonly CallWord[];
    readonly dataParameters: readonly number[];
}

const signatures = new WeakMap<FunctionStatement, FunctionCallSignature>();

export function functionCallSignature(statement: FunctionStatement): FunctionCallSignature {
    let signature = signatures.get(statement);
    if (!signature) {
        const leftCount = statement.leftParameters.length;
        const rightEnd = leftCount + statement.rightParameters.length;
        const bindings = [...statement.leftBindings, ...statement.rightBindings, ...statement.groups];
        const parameters = statement.parameters.map((name, index): CallParameter => ({
            name, index, deferred: bindings[index]?.deferred ?? false, acceptsFunction: !/^[A-Z]/.test(name),
            kind: index >= rightEnd ? 'option' : /^[a-z]/.test(name) ? 'function' : 'data',
        }));
        signature = {
            parameters, arity: parameters.length, leftCount,
            rightParameters: parameters.slice(leftCount, rightEnd),
            words: statement.groups.map((group, index) => ({ word: group.word,
                parameter: rightEnd + index, defaultValue: group.defaultValue })),
            dataParameters: parameters.filter(parameter => parameter.kind === 'data').map(parameter => parameter.index),
        };
        signatures.set(statement, signature);
    }
    return signature;
}
