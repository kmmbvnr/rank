import {
    isFunctionBindingStatement, isFunctionStatement, isNameExpression,
    isParenthesizedExpression, type Expression, type FunctionBindingStatement,
    type FunctionStatement, type Program,
} from './generated/ast.js';
import { AstUtils, type AstNode } from 'langium';
import { applicationExpression, flattenApplication, groupedExpression } from './expressions.js';
import { operationArities } from './operations.js';
import { functionPipelinePlan } from './function-pipeline.js';

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
        const { arities: signature, stages, error } = functionPipelinePlan(node.value, arities,
            name => known.get(name) === false);
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
