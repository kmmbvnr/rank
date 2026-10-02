import { AstUtils } from 'langium';
import {
    isApplicationExpression, isArrayAssignmentStatement, isAssignmentStatement, isBinaryExpression,
    isExpressionStatement, isLabelLiteral, isNameExpression, isParenthesizedExpression, isTestStatement, isUseStatement, isFunctionStatement,
    type Expression, type Program,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { findOperation } from '../operations.js';
import { mapsScalarCells } from './types.js';
import { expressionFacts } from './value-facts.js';
import { analyzeValues } from './value-diagnostics.js';
import { stableRecordField, UNKNOWN_VALUE, type ValueFacts } from './value-domain.js';

export interface FunctionTestExample {
    readonly name: string;
    readonly arguments: readonly ValueFacts[];
    readonly expected: ValueFacts;
    readonly test: string;
    readonly line: number;
}

/** Result facts of calling a function of the tested module; empty types when nothing is proven. */
export type ModuleSummary = (name: string, arguments_: readonly ValueFacts[]) => ValueFacts;

/** Summarizes calls into `program` by analyzing the called function, never by running it. */
export function moduleSummary(program: Program): ModuleSummary {
    return (name, arguments_) => analyzeValues(program, new Map(), new Map(),
        [{ name, arguments: arguments_ }]).functionResults[0] ?? UNKNOWN_VALUE;
}

/**
 * Expected examples, not contracts. No test execution occurs here. Without `summarize`, a call
 * into the tested module binds an unknown value, so records it builds carry no facts.
 */
export function functionTestExamples(program: Program, moduleName?: string,
    moduleFunctions?: ReadonlySet<string>, summarize?: ModuleSummary): FunctionTestExample[] {
    const examples: FunctionTestExample[] = [];
    const localFunctions = new Set(program.statements.filter(isFunctionStatement).map(statement => statement.name));
    const knownFunctions = moduleFunctions ?? (moduleName === undefined ? localFunctions : undefined);
    for (const test of program.statements) {
        if (!isTestStatement(test)) continue;
        const imports = test.statements.filter(isUseStatement).filter(statement =>
            statement.path?.replace(/^\.\//, '').replace(/\.ra$/, '') === moduleName);
        if (moduleName !== undefined && !imports.length) continue;
        if (moduleName === undefined && test.statements.some(statement => isUseStatement(statement) && !statement.alias)) continue;
        const bindings = new Map<string, ValueFacts>();
        const calls = new Map<string, { name: string; arguments: ValueFacts[]; shapePreserved?: true }>();
        const unwrap = (expression: Expression): Expression => isParenthesizedExpression(expression) ? unwrap(expression.value) : expression;
        const call = (expression: Expression) => {
            expression = unwrap(expression);
            if (isNameExpression(expression)) return calls.get(expression.name);
            if (!isApplicationExpression(expression)) return undefined;
            const parts = flattenApplication(expression);
            const last = parts.at(-1);
            if (!isNameExpression(last)) return undefined;
            const operation = knownFunctions && !knownFunctions.has(last.name) && !localFunctions.has(last.name)
                ? findOperation(last.name) : undefined;
            if (operation && operation.arities.includes(parts.length - 1)
                && (operation.module === 'core' || test.statements.some(statement =>
                    isUseStatement(statement) && !statement.alias
                    && statement.module === operation.module))
                && (mapsScalarCells(operation) || operation.preservesCollectionElements)) {
                const source = unwrap(parts[0]);
                const prior = isNameExpression(source) ? calls.get(source.name) : undefined;
                if (prior) return { ...prior, shapePreserved: true as const };
            }
            const imported = imports.find(statement => statement.alias
                ? last.name.startsWith(statement.alias + '.') : !last.name.includes('.'));
            if (moduleName !== undefined ? !imported : !localFunctions.has(last.name)) return undefined;
            const name = imported?.alias ? last.name.slice(imported.alias.length + 1) : last.name;
            if (knownFunctions && !knownFunctions.has(name)) return undefined;
            const prefix = expression.head;
            const prefixParts = isApplicationExpression(prefix) ? flattenApplication(prefix) : [];
            const prefixLast = prefixParts.at(-1);
            const prefixOperation = prefixLast && isNameExpression(prefixLast)
                && !bindings.has(prefixLast.name) && !localFunctions.has(prefixLast.name)
                ? findOperation(prefixLast.name) : undefined;
            const piped = prefixOperation && prefixOperation.arities.includes(prefixParts.length - 1)
                && (prefixOperation.module === 'core' || test.statements.some(statement =>
                    isUseStatement(statement) && !statement.alias
                    && statement.module === prefixOperation.module));
            return { name,
                arguments: (piped ? [prefix] : parts.slice(0, -1))
                    .map(part => expressionFacts(part, name => bindings.get(name))) };
        };
        // A call or write may reach a record through an alias and resize its fields, but a field
        // keeps its runtime type, so only the dimensions and cells of every record are forgotten.
        const forgetFieldDimensions = () => {
            for (const [name, fact] of bindings) if (fact.types.join() === 'record') {
                bindings.set(name, { ...fact, ...stableRecordField(fact) });
            }
        };
        const hasCall = (expression: Expression) =>
            AstUtils.streamAst(expression).some(node => isApplicationExpression(node));
        for (const statement of test.statements) {
            if (isArrayAssignmentStatement(statement) && bindings.get(statement.name)?.types.join() === 'record') {
                const target = bindings.get(statement.name)!;
                const value = expressionFacts(statement.value, name => bindings.get(name));
                forgetFieldDimensions();
                const [index] = statement.indices;
                const field = statement.indices.length === 1 && statement.operator === '='
                    && !index.all && !index.spread && index.value && isLabelLiteral(index.value)
                    ? index.value.name : undefined;
                const previous = field === undefined ? undefined : target.fields?.[field];
                const kept = bindings.get(statement.name)!;
                bindings.set(statement.name, field !== undefined && previous && value.types.length
                    && value.types.join() === previous.types.join()
                    ? { ...kept, fields: { ...kept.fields, [field]: value } } : UNKNOWN_VALUE);
                calls.delete(statement.name);
                continue;
            }
            if (isAssignmentStatement(statement) && statement.operator === '=') {
                const invocation = call(statement.value);
                const facts = expressionFacts(statement.value, name => bindings.get(name));
                const summary = invocation && !invocation.shapePreserved ? summarize?.(invocation.name,
                    invocation.arguments) : undefined;
                if (hasCall(statement.value)) forgetFieldDimensions();
                if (invocation) calls.set(statement.name, invocation); else calls.delete(statement.name);
                bindings.set(statement.name, summary?.types.length ? summary : facts);
            } else if (isExpressionStatement(statement) && isBinaryExpression(statement.value)
                && statement.value.operator === 'equal') {
                const invocation = call(statement.value.left);
                let expected = expressionFacts(statement.value.right, name => bindings.get(name));
                const comparable = !invocation?.shapePreserved || expected.types.join() === 'array';
                if (invocation?.shapePreserved && comparable) {
                    expected = { types: ['array'], rank: expected.rank, shape: expected.shape };
                }
                if (invocation && comparable) examples.push({ name: invocation.name,
                    arguments: invocation.arguments, expected, test: test.description,
                    line: (statement.$cstNode?.range.start.line ?? 0) + 1 });
                forgetFieldDimensions();
            } else if (!isUseStatement(statement)) {
                forgetFieldDimensions();
            }
        }
    }
    return examples;
}
