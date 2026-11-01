import { isNameExpression, type DeclaredCallExpression, type FunctionStatement, functionCallSignature } from '@arrrank/language';

/** Argument order is already bound by the parser; modifiers keep their own evaluator. */
export function positionalDeclaredCall(call: DeclaredCallExpression) {
    if (call.ranks.length || call.axes.length || !isNameExpression(call.callee)
        || call.dataParameters.length !== call.arguments.length
        || !call.dataParameters.every((parameter, index) => parameter === index)) return undefined;
    return [...call.arguments, call.callee];
}

/** This lowering evaluates every operand. Lazy and configurable calls retain their frame. */
export function strictDataCall(statement: FunctionStatement): boolean {
    const signature = functionCallSignature(statement);
    return !signature.words.length && signature.parameters.every(parameter => parameter.kind === 'data' && !parameter.deferred);
}
