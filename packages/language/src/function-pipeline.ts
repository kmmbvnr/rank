import {
    isHigherOrderOperator, isNameExpression, isNumberLiteral, isUnaryExpression,
    type Expression,
} from './generated/ast.js';
import { flattenApplication } from './expressions.js';
import type { FunctionCallSignature } from './function-call-signature.js';
import { findOperation } from './operations.js';

export interface FunctionPipelinePlan {
    readonly arities: readonly number[];
    readonly stages: readonly (readonly Expression[])[];
    readonly error?: string;
}

/** Plan a function-expression pipeline without visiting declarations or creating bodies. */
export function functionPipelinePlan(
    expression: Expression,
    arities: (name: string) => readonly number[] | undefined,
    isDataBinding: (name: string) => boolean,
    declarations: ReadonlyMap<string, FunctionCallSignature> = new Map(),
): FunctionPipelinePlan {
    const parts = flattenApplication(expression);
    const first = parts[0];
    const numeric = (node: Expression | undefined) => isNumberLiteral(node)
        || isUnaryExpression(node) && node.operator === '-' && isNumberLiteral(node.operand);
    const stages: Expression[][] = [];
    let error: string | undefined;
    for (let index = 0; index < parts.length;) {
        const head = parts[index++];
        if (!isNameExpression(head) && !isHigherOrderOperator(head)) {
            error = 'Implicit functions require an operation pipeline. Use explicit parameters for an expression body.';
            break;
        }
        const stage: Expression[] = [head];
        const words = isNameExpression(head) ? declarations.get(head.name)?.words.map(group => group.word) ?? [] : [];
        // Operation parameters and rank/axis modifiers belong to this stage.
        while (index < parts.length) {
            const next = parts[index];
            if (isNameExpression(next) && ['rank', 'axis', 'with', ...words].includes(next.name)) {
                stage.push(parts[index++]);
                if (index < parts.length) stage.push(parts[index++]);
                if (next.name === 'rank' && numeric(parts[index])) stage.push(parts[index++]);
                if (next.name === 'axis') while (numeric(parts[index])) stage.push(parts[index++]);
            } else if (!isNameExpression(next) && !isHigherOrderOperator(next)) stage.push(parts[index++]);
            else break;
        }
        stages.push(stage);
    }
    const entry = isHigherOrderOperator(first) ? [1]
        : isNameExpression(first) ? arities(first.name) ?? [] : [];
    const fixed = (stage: Expression[]) => {
        let count = 0;
        const head = stage[0];
        const words = isNameExpression(head) ? declarations.get(head.name)?.words.map(group => group.word) ?? [] : [];
        for (let index = 1; index < stage.length; index++) {
            const part = stage[index];
            if (isNameExpression(part) && ['rank', 'axis', 'with', ...words].includes(part.name)) {
                index++;
                if (part.name === 'rank' && numeric(stage[index + 1])) index++;
                if (part.name === 'axis') while (numeric(stage[index + 1])) index++;
            } else count++;
        }
        return count;
    };
    const stageArities = (stage: Expression[], supported: readonly number[]) => {
        const rank = stage.findIndex(part => isNameExpression(part) && part.name === 'rank');
        const binaryRank = rank >= 0 && numeric(stage[rank + 2]);
        const head = stage[0];
        const operation = isNameExpression(head) ? findOperation(head.name) : undefined;
        const parameters = operation?.formOnly || operation?.name === 'text' ? 0 : fixed(stage);
        return supported.map(count => count - parameters).filter(count => count >= 0 && (!binaryRank || count === 2));
    };
    const signature = stageArities(stages[0] ?? [], entry);
    for (const stage of stages.slice(1)) {
        const head = stage[0];
        const supported = isHigherOrderOperator(head) ? [1]
            : isNameExpression(head) ? arities(head.name) : undefined;
        if (supported && !stageArities(stage, supported).includes(1)) error = `Pipeline stage ${isNameExpression(head) ? head.name : 'operation'} must accept one value; use explicit parameters for additional operands.`;
    }
    if (!signature.length && !error && (entry.length > 0 || isNameExpression(first) && isDataBinding(first.name))) error = 'The pipeline entry must be a function.';
    return { arities: signature, stages, error };
}
