import { AstUtils } from 'langium';
import { isFunctionStatement, type FunctionStatement, type Program, type ReturnStatement } from './generated/ast.js';

/** Both declaration forms expose one ordered parameter list and one statement body. */
export function prepareFunctionDeclarations(program: Program): void {
    for (const node of AstUtils.streamAllContents(program)) {
        if (!isFunctionStatement(node)) continue;
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
