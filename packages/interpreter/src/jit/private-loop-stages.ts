import { AstUtils } from 'langium';
import {
    flattenApplication, isApplicationExpression, isArrayAssignmentStatement, isAssignmentStatement,
    isBinaryExpression, isBooleanLiteral, isForStatement, isIfStatement, isNameExpression,
    isNumberLiteral, isParenthesizedExpression, isUnaryExpression, isUnpackStatement,
    type AssignmentStatement, type Expression, type FunctionStatement, type Statement,
} from '@arrrank/language';

const operators = new Set(['+', '-', '*', '/', '//', 'mod', 'equal', 'notequal', 'less', 'greater', 'atmost', 'atleast']);
const consumers = new Set(['copy', 'indices', 'sum']);
export interface PrivateLoopStage {
    readonly expression: Expression;
    readonly reads: ReadonlySet<string>;
    readonly operators: ReadonlySet<string>;
}

/** A private plan can be consumed in place when its captured inputs stay put.
 * Public bindings, escaping plans, unknown calls and mutations keep the ordinary
 * constructor. This analysis never evaluates the recipe or removes an eager =. */
export function privateLoopStages(statement: FunctionStatement): ReadonlyMap<AssignmentStatement, PrivateLoopStage> {
    const nodes = [...AstUtils.streamAst(statement)];
    const stages = new Map<AssignmentStatement, PrivateLoopStage>();
    function pure(expression: Expression, reads: Set<string>, syntax: Set<string>, consumption = false, covered = false, name?: string): boolean {
        if (isParenthesizedExpression(expression)) return pure(expression.value, reads, syntax, consumption, covered, name);
        if (isNameExpression(expression)) {
            reads.add(expression.name);
            return expression.name !== name || covered;
        }
        if (isNumberLiteral(expression) || isBooleanLiteral(expression)) return true;
        if (isUnaryExpression(expression) && ['+', '-'].includes(expression.operator)) return pure(expression.operand, reads, syntax, consumption, covered, name);
        if (isBinaryExpression(expression) && !expression.step && operators.has(expression.operator)) {
            syntax.add(expression.operator);
            return pure(expression.left, reads, syntax, consumption, covered, name)
                && pure(expression.right, reads, syntax, consumption, covered, name);
        }
        if (consumption && isApplicationExpression(expression)) {
            const parts = flattenApplication(expression), last = parts.at(-1);
            if (parts.length === 2 && isNameExpression(last) && consumers.has(last.name)) {
                syntax.add(last.name);
                return pure(parts[0], reads, syntax, true, true, name);
            }
        }
        return false;
    }
    function block(commands: readonly Statement[]): void {
        for (let at = 0; at < commands.length; at++) {
            const command = commands[at];
            if (isForStatement(command)) block(command.statements);
            else if (isIfStatement(command)) {
                block(command.thenStatements); block(command.elseStatements);
                command.elifClauses.forEach(branch => block(branch.statements));
            }
            if (!isAssignmentStatement(command) || !command.deferred || command.operator !== '=' || command.name.includes('.')) continue;
            if (statement.parameters.includes(command.name)
                || nodes.some(node => isUnpackStatement(node) && node.names.includes(command.name))
                || nodes.filter(node => isAssignmentStatement(node) && node.name === command.name).length !== 1) continue;
            const reads = new Set<string>(), syntax = new Set<string>();
            if (!pure(command.value, reads, syntax) || reads.has(command.name)) continue;
            const uses = nodes.filter(isNameExpression).filter(node => node.name === command.name);
            const admitted = new Set<Expression>();
            let last = at;
            for (let index = at + 1; index < commands.length; index++) {
                const next = commands[index];
                if (!isAssignmentStatement(next) || next.deferred || next.operator !== '=') continue;
                const names = [...AstUtils.streamAst(next.value)].filter(isNameExpression).filter(node => node.name === command.name);
                if (!names.length) continue;
                if (!pure(next.value, new Set(), new Set(), true, false, command.name)) continue;
                names.forEach(node => admitted.add(node)); last = index;
            }
            if (uses.some(node => !admitted.has(node))) continue;
            let stable = true;
            for (let index = at + 1; index <= last; index++) {
                const next = commands[index];
                if (!isAssignmentStatement(next) || next.deferred || next.operator !== '='
                    || !pure(next.value, new Set(), new Set(), true)
                    || index < last && reads.has(next.name)
                    || [...AstUtils.streamAst(next)].some(isArrayAssignmentStatement)) { stable = false; break; }
            }
            if (stable) stages.set(command, { expression: command.value, reads, operators: syntax });
        }
    }
    block(statement.statements);
    return stages;
}
