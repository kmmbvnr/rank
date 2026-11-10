import { isNameExpression, type DeclaredCallExpression, type FunctionStatement, functionCallSignature, declaredRanks } from '@arrrank/language';
import type { CompiledCalleeType } from './compiled-callee-type.js';

/** Argument order is already bound by the parser; modifiers keep their own evaluator. */
export function positionalDeclaredCall(call: DeclaredCallExpression) {
    if (call.ranks.length || call.axes.length || !isNameExpression(call.callee)) return undefined;
    return [...call.arguments, call.callee];
}

/** This lowering evaluates every operand. Lazy and configurable calls retain their frame. */
export function strictDataCall(statement: FunctionStatement): boolean {
    const signature = functionCallSignature(statement);
    return !signature.words.length && signature.parameters.every(parameter => parameter.kind === 'data' && !parameter.deferred);
}

/** Direct linking is valid only when rank dispatch would pass each operand whole. */
export function wholeDeclaredCall(statement: FunctionStatement, types: readonly CompiledCalleeType[]): boolean {
    const declared = declaredRanks(statement);
    if (!declared) return true;
    if (typeof declared === 'string') return false;
    return declared.ranks.every((rank, index) => {
        if (rank === 'all') return true;
        const type = types[functionCallSignature(statement).dataParameters[index]];
        const actual = typeof type === 'string' ? type === 'text' ? 1 : 0
            : type?.kind === 'array' ? type.rank : undefined;
        return actual !== undefined && (actual === 0 || rank >= actual);
    });
}
