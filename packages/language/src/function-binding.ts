import {
    isFunctionBindingStatement, isFunctionStatement, isHigherOrderOperator, isNameExpression,
    isNumberLiteral, isUnaryExpression, isParenthesizedExpression, type Expression, type FunctionBindingStatement,
    type FunctionStatement, type Program,
} from './generated/ast.js';
import { AstUtils, type AstNode } from 'langium';
import { applicationExpression, flattenApplication, groupedExpression } from './expressions.js';
import { findOperation, operationArities } from './operations.js';

export interface FunctionBindingPlan {
    readonly arities: readonly number[];
    readonly alias?: string;
    readonly value?: Expression;
    readonly definitions: readonly FunctionStatement[];
    readonly stages?: readonly (readonly Expression[])[];
    readonly error?: string;
}
const plans = new WeakMap<FunctionBindingStatement, FunctionBindingPlan>();
export function functionBindingPlan(statement: FunctionBindingStatement): FunctionBindingPlan {
    return plans.get(statement) ?? { arities: [], definitions: [], error: 'Unprepared function binding' };
}

/** Build ordinary return bodies before expression grouping. Nothing is evaluated here. */
export function prepareFunctionBindings(program: Program, signatures: ReadonlyMap<string, readonly number[] | false> = new Map()): void {
    let known = new Map(signatures);
    for (const node of program.statements) {
        if (isFunctionStatement(node)) known.set(node.name, [node.parameters.length]);
    }
    const arities = (name: string): readonly number[] | undefined => {
        const local = known.get(name);
        return local === false ? undefined : local ?? operationArities(name);
    };
    const numeric = (node: Expression | undefined) => isNumberLiteral(node)
        || isUnaryExpression(node) && node.operator === '-' && isNumberLiteral(node.operand);
    const visit = (node: AstNode): void => {
        if (isFunctionStatement(node)) {
            const outer = known;
            known = new Map(known);
            for (const declaration of node.statements) {
                if (isFunctionStatement(declaration)) known.set(declaration.name, [declaration.parameters.length]);
            }
            node.statements.forEach(visit);
            known = outer;
            return;
        }
        if (!isFunctionBindingStatement(node)) {
            for (const child of AstUtils.streamContents(node)) visit(child);
            return;
        }
        const definitions: FunctionStatement[] = [];
        const define = (parameters: string[], body: Expression): void => {
            definitions.push({ $type: 'FunctionStatement', name: node.name, parameters, ranks: [], memo: false,
                statements: [{ $type: 'ReturnStatement', value: body, $cstNode: node.$cstNode }],
                $cstNode: node.$cstNode } as unknown as FunctionStatement);
        };
        if (node.parameters.length) {
            define(node.parameters, node.value);
            plans.set(node, { arities: [node.parameters.length], definitions });
            known.set(node.name, [node.parameters.length]);
            return;
        }
        const parts = flattenApplication(node.value);
        const first = parts[0];
        if (parts.length === 1 && isParenthesizedExpression(first)) {
            plans.set(node, { arities: [], definitions, value: first });
            known.set(node.name, []);
            return;
        }
        if (parts.length === 1 && isNameExpression(first)) {
            const signature = arities(first.name) ?? [];
            plans.set(node, { arities: signature, alias: first.name, definitions });
            known.set(node.name, signature);
            return;
        }
        const stages: Expression[][] = [];
        let error: string | undefined;
        for (let index = 0; index < parts.length;) {
            const head = parts[index++];
            if (!isNameExpression(head) && !isHigherOrderOperator(head)) {
                error = 'Implicit functions require an operation pipeline. Use explicit parameters for an expression body.';
                break;
            }
            const stage: Expression[] = [head];
            // Operation parameters and rank/axis modifiers belong to this stage.
            while (index < parts.length) {
                const next = parts[index];
                if (isNameExpression(next) && ['rank', 'axis', 'with'].includes(next.name)) {
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
            for (let index = 1; index < stage.length; index++) {
                const part = stage[index];
                if (isNameExpression(part) && ['rank', 'axis', 'with'].includes(part.name)) {
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
        if (!signature.length && !error && (entry.length > 0 || isNameExpression(first) && known.get(first.name) === false)) error = 'The pipeline entry must be a function.';
        for (const count of signature) {
            const parameters = Array.from({ length: count }, (_, index) => `operand${index}`);
            let operands: Expression[] = parameters.map(name => ({ $type: 'NameExpression', name } as Expression));
            let body: Expression = node.value;
            for (const stage of stages) {
                body = applicationExpression([...operands, ...stage], node.value);
                operands = [groupedExpression(body)];
            }
            define(parameters, body);
        }
        plans.set(node, { arities: signature, definitions, stages, error });
        known.set(node.name, signature);
    };
    visit(program);
}
