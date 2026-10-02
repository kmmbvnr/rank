import { AstUtils } from 'langium';
import {
    isApplicationExpression, isArrayAssignmentStatement, isAssignmentStatement, isBinaryExpression,
    isExpressionStatement, isLabelLiteral, isNameExpression, isParenthesizedExpression, isPushStatement,
    isTestStatement, isUseStatement, isFunctionStatement,
    type Expression, type Program,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { findOperation } from '../operations.js';
import { mapsScalarCells } from './types.js';
import { expressionFacts } from './value-facts.js';
import { analyzeValues } from './value-diagnostics.js';
import { stableRecordField, UNKNOWN_VALUE, type ValueFacts } from './value-domain.js';

/** A module function the test applied to build one element of a collection argument. */
export interface ConstructorCall {
    readonly name: string;
    readonly arguments: readonly ValueFacts[];
}

export interface FunctionTestExample {
    readonly name: string;
    readonly arguments: readonly ValueFacts[];
    /** Per argument: the ordered pushes of module-function results that filled a fresh collection. */
    readonly constructions?: readonly (readonly ConstructorCall[] | undefined)[];
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
        const calls = new Map<string, { name: string; arguments: ValueFacts[]; shapePreserved?: true;
            constructions?: (readonly ConstructorCall[] | undefined)[] }>();
        // Fresh collections whose every element came from a module function call.
        const filled = new Map<string, ConstructorCall[]>();
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
            const inputs = piped ? [prefix] : parts.slice(0, -1);
            const constructions = inputs.map(part => {
                const input = unwrap(part);
                return isNameExpression(input) ? filled.get(input.name)?.slice() : undefined;
            });
            // A piped prefix is evaluated by an operation, which may change what it reads.
            if (piped) unsettle(prefix);
            return { name,
                arguments: inputs.map(part => expressionFacts(part, name => bindings.get(name))),
                ...(constructions.some(sites => sites !== undefined) ? { constructions } : {}) };
        };
        const emptyCollection = (fact: ValueFacts | undefined): boolean => fact?.types.length === 1
            && ['queue', 'stack', 'deque'].includes(fact.types[0]) && !fact.elements?.length;
        const unsettle = (expression: { readonly $cstNode?: { readonly text: string } }) => {
            // Any other use of a filled collection may change it.
            for (const name of [...filled.keys()]) {
                if (expression.$cstNode?.text.split(/\s+/).includes(name)) filled.delete(name);
            }
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
                filled.delete(statement.name);
                unsettle(statement.value);
                if (invocation) calls.set(statement.name, invocation); else calls.delete(statement.name);
                bindings.set(statement.name, summary?.types.length ? summary : facts);
                if (emptyCollection(bindings.get(statement.name))) filled.set(statement.name, []);
            } else if (isPushStatement(statement)) {
                const receiver = unwrap(statement.receiver);
                const sites = isNameExpression(receiver) ? filled.get(receiver.name) : undefined;
                const invocation = call(statement.value);
                if (sites && invocation && !invocation.shapePreserved) {
                    sites.push({ name: invocation.name, arguments: invocation.arguments });
                } else if (isNameExpression(receiver)) filled.delete(receiver.name);
                unsettle(statement.value);
                forgetFieldDimensions();
            } else if (isExpressionStatement(statement) && isBinaryExpression(statement.value)
                && statement.value.operator === 'equal') {
                const invocation = call(statement.value.left);
                unsettle(statement.value.right);
                if (!invocation) {
                    unsettle(statement.value.left);
                    forgetFieldDimensions();
                    continue;
                }
                let expected = expressionFacts(statement.value.right, name => bindings.get(name));
                const comparable = !invocation.shapePreserved || expected.types.join() === 'array';
                if (invocation.shapePreserved && comparable) {
                    expected = { types: ['array'], rank: expected.rank, shape: expected.shape };
                }
                if (comparable) examples.push({ name: invocation.name, arguments: invocation.arguments,
                    ...(invocation.constructions ? { constructions: invocation.constructions } : {}), expected,
                    test: test.description, line: (statement.$cstNode?.range.start.line ?? 0) + 1 });
                forgetFieldDimensions();
            } else {
                unsettle(statement);
                if (!isUseStatement(statement)) forgetFieldDimensions();
            }
        }
    }
    return examples;
}
