import { AstUtils, type AstNode } from 'langium';
import {
    isAddStatement, isArrayAssignmentStatement, isAssignmentStatement, isBreakStatement,
    isContinueStatement, isExpressionStatement, isForStatement, isFunctionStatement,
    isIfStatement, isNameExpression, isPushStatement, isReturnStatement, isTryStatement,
    isUnpackStatement, isIndexAssignmentStatement,
    type Expression, type ForStatement, type Statement, type TryStatement,
} from '../generated/ast.js';
import { contractRank, conditionalPaths, mergeEnvironments } from './control-flow.js';
import { UNKNOWN_VALUE, type ValueFacts } from './value-domain.js';

export interface ReturnPaths {
    values: ValueFacts[];
    fallsThrough: boolean;
    breaks: Map<string, ValueFacts>[];
    continues: Map<string, ValueFacts>[];
}
interface ReturnPathContext {
    diagnostics: { node: AstNode; message: string; kind: 'TypeError' | 'DimensionMismatch' }[];
    directCallBeforeEffects(expression: Expression, env: Map<string, ValueFacts>): ValueFacts | undefined;
    directNoReturnCall(expression: Expression, env: ReadonlyMap<string, ValueFacts>): boolean;
    invalidateCalls(expression: AstNode, env: Map<string, ValueFacts>): void;
    inspect(expression: Expression, env: Map<string, ValueFacts>): ValueFacts;
    tryPrefixFacts(statement: TryStatement, env: Map<string, ValueFacts>): Map<string, ValueFacts> | undefined;
    forgetNonFunctions(env: Map<string, ValueFacts>): void;
    loop(statement: ForStatement, env: Map<string, ValueFacts>): void;
    loopReturnPaths(statement: ForStatement, env: Map<string, ValueFacts>): ValueFacts[];
    statements(items: readonly Statement[], env: Map<string, ValueFacts>): boolean;
}

/** Return values and surviving environments for calls, branches and loops. */
export function createReturnPathAnalysis(context: ReturnPathContext) {
    const { diagnostics } = context;
    function returnPaths(items: readonly Statement[], env: Map<string, ValueFacts>): ReturnPaths {
        const values: ValueFacts[] = [];
        const breaks: Map<string, ValueFacts>[] = [];
        const continues: Map<string, ValueFacts>[] = [];
        for (const statement of items) {
            if (isBreakStatement(statement)) return { values, fallsThrough: false, breaks: [...breaks, env], continues };
            if (isContinueStatement(statement)) return { values, fallsThrough: false, breaks, continues: [...continues, env] };
            if (isReturnStatement(statement)) {
                const beforeEffects = statement.value && context.directCallBeforeEffects(statement.value, env);
                if (statement.value) context.invalidateCalls(statement.value, env);
                const observed = statement.value ? beforeEffects ?? context.inspect(statement.value, env) : UNKNOWN_VALUE;
                const contract = statement.value && isNameExpression(statement.value)
                    ? env.get(statement.value.name) : undefined;
                const result = observed.types.length || !contract?.acceptedTypes?.length ? observed
                    : { types: contract.acceptedTypes, acceptedArrayRank: contractRank(contract) };
                if (!statement.value || !context.directNoReturnCall(statement.value, env)) values.push(result);
                return { values, fallsThrough: false, breaks, continues };
            }
            if (isIfStatement(statement)) {
                const branches = conditionalPaths(statement, env, diagnostics, context.inspect, context.invalidateCalls);
                const survivors: Map<string, ValueFacts>[] = [];
                for (const branch of branches) {
                    const local = branch.env;
                    const diagnosticStart = diagnostics.length;
                    const result = returnPaths(branch.items, local);
                    // A call-site fact must not accuse an unproven branch of executing.
                    // Return facts still join all possible paths conservatively.
                    if (branches.length > 1) diagnostics.length = diagnosticStart;
                    values.push(...result.values);
                    breaks.push(...result.breaks);
                    continues.push(...result.continues);
                    if (result.fallsThrough) survivors.push(local);
                }
                if (!survivors.length) return { values, fallsThrough: false, breaks, continues };
                mergeEnvironments(env, survivors);
            } else if (isTryStatement(statement) && !statement.finallyStatements.length) {
                if (statement.statements.length === 1 && isExpressionStatement(statement.statements[0])
                    && context.directNoReturnCall(statement.statements[0].value, env)) {
                    return { values, fallsThrough: false, breaks, continues };
                }
                const caughtFacts = context.tryPrefixFacts(statement, env);
                const success = new Map(env);
                const tried = returnPaths(statement.statements, success);
                values.push(...tried.values);
                breaks.push(...tried.breaks);
                continues.push(...tried.continues);
                const survivors = tried.fallsThrough ? [success] : [];
                for (const clause of statement.catches) {
                    // An error can occur after any prefix of the try body. Its
                    // bindings cannot be assumed to have their entry values.
                    const caught = new Map(env);
                    context.forgetNonFunctions(caught);
                    if (caughtFacts) for (const [name, fact] of caughtFacts) caught.set(name, fact);
                    caught.set(clause.errorName, UNKNOWN_VALUE);
                    const start = diagnostics.length;
                    const path = returnPaths(clause.statements, caught);
                    diagnostics.length = start;
                    values.push(...path.values);
                    breaks.push(...path.breaks);
                    continues.push(...path.continues);
                    if (path.fallsThrough) survivors.push(caught);
                }
                if (!survivors.length) return { values, fallsThrough: false, breaks, continues };
                mergeEnvironments(env, survivors);
            } else if (isForStatement(statement)) {
                const contents = [...AstUtils.streamAllContents(statement)];
                if (contents.some(isReturnStatement)) values.push(...context.loopReturnPaths(statement, env));
                else context.loop(statement, env);
            } else if (isAssignmentStatement(statement) || isArrayAssignmentStatement(statement)
                || isIndexAssignmentStatement(statement)
                || isAddStatement(statement) || isPushStatement(statement)
                || isUnpackStatement(statement)
                || isExpressionStatement(statement) || isFunctionStatement(statement)) {
                if (!context.statements([statement], env)) return { values, fallsThrough: false, breaks, continues };
            } else {
                // Unknown control flow may return, yield, throw or alter captured state.
                return { values: [UNKNOWN_VALUE], fallsThrough: true, breaks, continues };
            }
        }
        return { values, fallsThrough: true, breaks, continues };
    }

    return { returnPaths };
}
