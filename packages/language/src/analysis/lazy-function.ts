import { AstUtils } from 'langium';
import { isDeclaredCallExpression, isFunctionBindingStatement, isFunctionStatement, isNameExpression, isStdinExpression,
    type FunctionStatement } from '../generated/ast.js';
import { functionCallSignature } from '../function-call-signature.js';
import { findOperation } from '../operations.js';
import { functionScope } from './function-scopes.js';
import { mutatedFunctionParameters } from './function-mutations.js';

const builtinNames = new WeakMap<FunctionStatement, ReadonlySet<string>>();

/** Builtin implementations can have host overrides with stricter contracts. */
export function lazyBuiltinDependencies(statement: FunctionStatement): ReadonlySet<string> {
    let result = builtinNames.get(statement);
    if (!result) {
        result = new Set([...AstUtils.streamAllContents(statement)]
            .filter(isNameExpression).filter(node => {
                const owner = AstUtils.getContainerOfType(node, isFunctionStatement);
                return !owner || !functionScope(owner)?.reads.has(node);
            }).map(node => node.name).filter(name => findOperation(name)?.compiledCall?.hostFunction !== undefined));
        builtinNames.set(statement, result);
    }
    return result;
}

/** Conservative prerequisites for deferred pure calls. Capture values and
 * external callable identities still need checking by the runtime owner. */
export function lazyFunctionFailure(statement: FunctionStatement, seen = new Set<FunctionStatement>(), checkParameters = true): string | undefined {
    if (checkParameters && seen.size === 0) {
        const writes = mutatedFunctionParameters(statement);
        if (!writes) return 'unknown parameter effects';
        if (writes.size) return 'mutation through a callback parameter';
    }
    if (seen.has(statement)) return undefined;
    seen.add(statement);
    const scope = functionScope(statement);
    if (!scope) return 'unknown lexical dependencies';
    if (scope.externalEffects.size) return `external effect ${[...scope.externalEffects][0]}`;
    if (functionCallSignature(statement).parameters.some(parameter => parameter.acceptsFunction)) return 'unresolved callback parameter';
    for (const node of AstUtils.streamAllContents(statement)) {
        if (isStdinExpression(node)) return 'input';
        if (isFunctionBindingStatement(node)) return 'local callable binding';
        if (isDeclaredCallExpression(node) && !isNameExpression(node.callee)) return 'indirect callable';
    }
    for (const callee of scope.callees) {
        const reason = lazyFunctionFailure(callee, seen);
        if (reason) return reason;
    }
    return undefined;
}
