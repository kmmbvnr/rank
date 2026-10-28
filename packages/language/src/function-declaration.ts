import { AstUtils } from 'langium';
import {
    isExpressionStatement, isFunctionStatement, isLabelLiteral, isNameExpression, isPrimaryTailExpression,
    type FunctionStatement, type Program, type ReturnStatement,
} from './generated/ast.js';

/** Both declaration forms expose one ordered parameter list and one statement body. */
export function prepareFunctionDeclarations(program: Program): void {
    for (const node of AstUtils.streamAllContents(program)) {
        if (!isFunctionStatement(node)) continue;
        while (isExpressionStatement(node.statements[0]) && isPrimaryTailExpression(node.statements[0].value)) {
            const tail = node.statements[0].value;
            if (!isLabelLiteral(tail.head) || !/^[a-z]/.test(tail.head.name)
                || !isNameExpression(tail.argument) || !/^[A-Z]/.test(tail.argument.name)
                || tail.secondArgument || tail.arguments.length || tail.clause
                || tail.values.length || tail.entries.length || tail.deleteWrite) break;
            const statement = node.statements.shift()!;
            node.groups.push({
                $type: 'FunctionCallGroup', word: tail.head.name,
                parameter: tail.argument.name, deferred: false,
                $cstNode: statement.$cstNode, $container: node,
            });
        }
        if (node.leftBindings.length + node.rightBindings.length === 2) {
            const bindings = [...node.leftBindings, ...node.rightBindings];
            node.leftBindings = bindings.slice(0, 1);
            node.rightBindings = bindings.slice(1);
            AstUtils.linkContentToContainer(node);
        }
        node.leftParameters = node.leftBindings.map(parameter => parameter.name);
        node.rightParameters = node.rightBindings.map(parameter => parameter.name);
        node.parameters = [...node.leftParameters, ...node.rightParameters, ...node.groups.map(group => group.parameter)];
        if (node.expressionBody) {
            const value = node.expressionBody;
            node.statements = [{ $type: 'ReturnStatement', value, $cstNode: value.$cstNode } as ReturnStatement];
            delete node.expressionBody;
            AstUtils.linkContentToContainer(node);
        }
    }
}

/** Header errors shared by parsing and editor validation. */
export function functionDeclarationErrors(statement: FunctionStatement): string[] {
    const errors: string[] = [];
    const parameters = new Set<string>();
    for (const name of statement.parameters) {
        if (parameters.has(name)) errors.push(`Duplicate function parameter ${name}`);
        parameters.add(name);
    }
    const words = new Set<string>();
    for (const group of statement.groups) {
        if (group.word === 'rank' || group.word === 'axis') errors.push(`.${group.word} is reserved for interpreter modifiers`);
        if (words.has(group.word)) errors.push(`Duplicate function group .${group.word}`);
        words.add(group.word);
    }
    return errors;
}
