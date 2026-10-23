import { groupDeclaredCalls } from './declared-calls.js';
import { functionCallSignature, type FunctionCallSignature } from './function-call-signature.js';
import {
    isFunctionBindingStatement, isFunctionStatement, isNameExpression,
    isParenthesizedExpression, type Expression, type FunctionBindingStatement,
    type FunctionStatement, type Program,
} from './generated/ast.js';
import { AstUtils, type AstNode } from 'langium';
import { applicationExpression, flattenApplication, groupedExpression, markPlacedOperands } from './expressions.js';
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
export function prepareFunctionBindings(program: Program, signatures: ReadonlyMap<string, readonly number[] | false> = new Map(),
    declarations: ReadonlyMap<string, FunctionCallSignature> = new Map()): void {
    let known = new Map(signatures);
    let calls = new Map(declarations);
    const declare = (node: FunctionStatement): void => {
        const signature = functionCallSignature(node);
        known.set(node.name, [signature.leftCount + signature.rightParameters.length]);
        calls.set(node.name, signature);
    };
    for (const node of program.statements) {
        if (isFunctionStatement(node)) declare(node);
    }
    const arities = (name: string): readonly number[] | undefined => {
        const local = known.get(name);
        return local === false ? undefined : local ?? operationArities(name);
    };
    const visit = (node: AstNode): void => {
        if (isFunctionStatement(node)) {
            const outer = known, outerCalls = calls;
            known = new Map(known);
            calls = new Map(calls);
            for (const declaration of node.statements) {
                if (isFunctionStatement(declaration)) declare(declaration);
            }
            node.statements.forEach(visit);
            known = outer;
            calls = outerCalls;
            return;
        }
        if (!isFunctionBindingStatement(node)) {
            for (const child of AstUtils.streamContents(node)) visit(child);
            return;
        }
        const definitions: FunctionStatement[] = [];
        const define = (parameters: string[], body: Expression): void => {
            definitions.push({ $type: 'FunctionStatement', name: node.name, parameters,
                leftBindings: parameters.map(name => ({ $type: 'FunctionParameter', name, deferred: false })),
                rightBindings: [], leftParameters: parameters, rightParameters: [], groups: [], ranks: [], memo: false,
                statements: [{ $type: 'ReturnStatement', value: body, $cstNode: node.$cstNode }],
                $cstNode: node.$cstNode } as unknown as FunctionStatement);
        };
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
            const declared = calls.get(first.name);
            if (declared) calls.set(node.name, declared);
            return;
        }
        let { arities: signature, stages, error } = functionPipelinePlan(node.value, arities,
            name => known.get(name) === false, calls);
        for (const count of signature) {
            const parameters = Array.from({ length: count }, (_, index) => `operand${index}`);
            let operands: Expression[] = parameters.map(name => ({ $type: 'NameExpression', name } as Expression));
            let body: Expression = node.value;
            for (const stage of stages) {
                const head = stage[0];
                const declared = isNameExpression(head) ? calls.get(head.name) : undefined;
                if (declared && (declared.rightParameters.length || declared.words.length)) {
                    const parts = [...operands.slice(0, declared.leftCount), head,
                        ...operands.slice(declared.leftCount), ...stage.slice(1)];
                    body = applicationExpression(groupDeclaredCalls(parts,
                        expression => expression === head ? declared : undefined,
                        expression => isNameExpression(expression) && !!arities(expression.name)?.length,
                        (_expression, message) => { error ??= message; }), node.value);
                } else body = applicationExpression([...operands, markPlacedOperands({ ...head }), ...stage.slice(1)], node.value);
                operands = [groupedExpression(body)];
            }
            define(parameters, body);
        }
        plans.set(node, { arities: signature, definitions, stages, error });
        known.set(node.name, signature);
    };
    visit(program);
}
