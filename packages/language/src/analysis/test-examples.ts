import {
    isApplicationExpression, isAssignmentStatement, isBinaryExpression, isExpressionStatement,
    isNameExpression, isParenthesizedExpression, isTestStatement, isUseStatement, isFunctionStatement,
    type Expression, type Program,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';
import { expressionFacts, type ValueFacts } from './value-facts.js';

export interface FunctionTestExample {
    readonly name: string;
    readonly arguments: readonly ValueFacts[];
    readonly expected: ValueFacts;
    readonly test: string;
    readonly line: number;
}

/** Expected examples, not contracts. No module loading or test execution occurs here. */
export function functionTestExamples(program: Program, moduleName?: string): FunctionTestExample[] {
    const examples: FunctionTestExample[] = [];
    const localFunctions = new Set(program.statements.filter(isFunctionStatement).map(statement => statement.name));
    for (const test of program.statements) {
        if (!isTestStatement(test)) continue;
        const imports = test.statements.filter(isUseStatement).filter(statement =>
            statement.path?.replace(/^\.\//, '').replace(/\.ra$/, '') === moduleName);
        if (moduleName !== undefined && !imports.length) continue;
        if (moduleName === undefined && test.statements.some(statement => isUseStatement(statement) && !statement.alias)) continue;
        const bindings = new Map<string, ValueFacts>();
        const calls = new Map<string, { name: string; arguments: ValueFacts[] }>();
        const unwrap = (expression: Expression): Expression => isParenthesizedExpression(expression) ? unwrap(expression.value) : expression;
        const call = (expression: Expression) => {
            expression = unwrap(expression);
            if (isNameExpression(expression)) return calls.get(expression.name);
            if (!isApplicationExpression(expression)) return undefined;
            const parts = flattenApplication(expression);
            const last = parts.at(-1);
            if (!isNameExpression(last)) return undefined;
            const imported = imports.find(statement => statement.alias
                ? last.name.startsWith(statement.alias + '.') : !last.name.includes('.'));
            if (moduleName !== undefined ? !imported : !localFunctions.has(last.name)) return undefined;
            return { name: imported?.alias ? last.name.slice(imported.alias.length + 1) : last.name,
                arguments: parts.slice(0, -1).map(part => expressionFacts(part, name => bindings.get(name))) };
        };
        for (const statement of test.statements) {
            if (isAssignmentStatement(statement) && statement.operator === '=') {
                const invocation = call(statement.value);
                if (invocation) calls.set(statement.name, invocation); else calls.delete(statement.name);
                bindings.set(statement.name, expressionFacts(statement.value, name => bindings.get(name)));
            } else if (isExpressionStatement(statement) && isBinaryExpression(statement.value)
                && statement.value.operator === 'equal') {
                const invocation = call(statement.value.left);
                if (!invocation) continue;
                examples.push({ ...invocation, expected: expressionFacts(statement.value.right, name => bindings.get(name)),
                    test: test.description, line: (statement.$cstNode?.range.start.line ?? 0) + 1 });
            }
        }
    }
    return examples;
}
