import { AstUtils } from 'langium';
import {
    isArgStatement, isFunctionStatement, isReturnStatement, isTestStatement,
    type ArgStatement, type Program,
} from './generated/ast.js';
import type { CallParameter, FunctionCallSignature } from './function-call-signature.js';

/** A callable name is a lowercase word; an uppercase name would read as data. */
const CALL_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * A source file with a top-level `return` is a function: its `arg` lines are
 * the parameters and the returned value is the result. Files without one are
 * ordinary modules and keep their current behavior.
 */
export function isFileFunction(program: Program): boolean {
    return AstUtils.streamAst(program).some(node => isReturnStatement(node)
        && !AstUtils.getContainerOfType(node, isFunctionStatement)
        && !AstUtils.getContainerOfType(node, isTestStatement));
}

/** Left operands are the `arg` lines without a default, right operands the rest. */
export function fileFunctionInputs(program: Program): { left: ArgStatement[]; right: ArgStatement[] } {
    const inputs = program.statements.filter(isArgStatement);
    return { left: inputs.filter(input => !input.defaultValue), right: inputs.filter(input => input.defaultValue) };
}

/** The word a file is called by: its alias, or its file stem when that is a word. */
export function fileCallName(path: string, alias?: string): string | undefined {
    const name = alias ?? /([^/\\]+?)(?:\.[A-Za-z]+)?$/.exec(path)?.[1];
    return name !== undefined && CALL_NAME.test(name) ? name : undefined;
}

/** Call-shaped signature of a file function, as for a user function header. */
export function fileCallSignature(program: Program): FunctionCallSignature {
    const { left, right } = fileFunctionInputs(program);
    const parameter = (input: ArgStatement, index: number): CallParameter => ({
        name: input.name, index, deferred: false, acceptsFunction: false, kind: 'data' });
    const parameters = [...left, ...right].map(parameter);
    return {
        parameters, arity: parameters.length, leftCount: left.length,
        rightParameters: parameters.slice(left.length), words: [],
        dataParameters: parameters.map(item => item.index),
        optionalFrom: 0,
    };
}

/** Right operands may be left out from the end, so every count in range is allowed. */
export function fileCallArities(program: Program): number[] {
    const { left, right } = fileFunctionInputs(program);
    return Array.from({ length: right.length + 1 }, (_, extra) => left.length + extra);
}
