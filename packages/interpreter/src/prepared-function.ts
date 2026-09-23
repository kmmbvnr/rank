import {
    isFunctionStatement, functionYields, flatArrayBorrowCandidates,
    type FunctionStatement,
} from '@arrrank/language';

export interface PreparedFunction {
    readonly generator: boolean;
    readonly locals: readonly FunctionStatement[];
    readonly layout: Map<string, number>;
    readonly borrowedParameters: ReadonlySet<string>;
}

// Syntax and slot names are shared, never values. Closures remain per invocation.
const prepared = new WeakMap<FunctionStatement, PreparedFunction>();

export function prepareFunction(statement: FunctionStatement): PreparedFunction {
    let result = prepared.get(statement);
    if (!result) {
        const generator = functionYields(statement).length > 0;
        result = {
            generator,
            locals: statement.statements.filter(isFunctionStatement),
            layout: new Map([...new Set(statement.parameters)].map((name, index) => [name, index])),
            borrowedParameters: inferBorrowedParameters(statement, generator),
        };
        prepared.set(statement, result);
    }
    return result;
}

function inferBorrowedParameters(statement: FunctionStatement, isGenerator: boolean): ReadonlySet<string> {
    if (isGenerator || statement.parameters.length === 0) return new Set();
    // Dynamic helper calls need a call-site identity guard, so preparation
    // only accepts proofs that do not resolve another function.
    const indices = flatArrayBorrowCandidates(statement, () => undefined);
    return new Set(statement.parameters.filter((_, index) => indices.has(index)));
}
