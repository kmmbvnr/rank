import { AstUtils } from 'langium';
import {
    isApplicationExpression, isArrayAssignmentStatement, isArrayExpression, isAssignmentStatement,
    isBinaryExpression, isBooleanLiteral, isExpressionStatement, isIfStatement, isLabelLiteral,
    isNameExpression, isNumberLiteral, isParenthesizedExpression, isReturnStatement,
    isStringLiteral, isTextBlockExpression, isUnaryExpression,
    type ArrayAssignmentStatement, type Expression, type FunctionStatement, type Statement,
} from '../generated/ast.js';
import { flattenApplication } from '../expressions.js';

/** Possible writes, not a purity promise. Unknown includes I/O and unsupported syntax. */
export interface FunctionEffects {
    readonly unknown: boolean;
    readonly parameters: ReadonlySet<number>;
    readonly captures: ReadonlySet<string>;
}

/** Resolve only definitions whose binding identity is still known at the call site. */
export function functionEffects(resolve: (name: string) => FunctionStatement | undefined,
    isFunction: (name: string) => boolean): (name: string) => FunctionEffects {
    const cache = new Map<string, FunctionEffects>();
    const active = new Set<string>();
    const unknown: FunctionEffects = { unknown: true, parameters: new Set(), captures: new Set() };
    let budget = 100;
    function analyze(name: string): FunctionEffects {
        const cached = cache.get(name);
        if (cached) return cached;
        const definition = resolve(name);
        if (!definition || active.has(name) || budget-- <= 0) return unknown;
        if (![...AstUtils.streamAllContents(definition)].some(isReturnStatement)) return unknown;
        const parameters = new Set<number>();
        const captures = new Set<string>();
        const assignments = new Set([...AstUtils.streamAllContents(definition)]
            .filter(isAssignmentStatement).map(node => node.name));
        const locals = new Set([...definition.parameters, ...assignments]);
        const write = (target: string): boolean => {
            // Rebound parameters and local aliases need provenance analysis.
            if (assignments.has(target) || target.includes('.')) return false;
            const index = definition.parameters.indexOf(target);
            if (index >= 0) parameters.add(index);
            else captures.add(target);
            return true;
        };
        const expression = (value: Expression): boolean => {
            if (isNameExpression(value)) return locals.has(value.name)
                || /^[A-Z]/.test(value.name) && !isFunction(value.name);
            if (isApplicationExpression(value)) {
                const parts = flattenApplication(value);
                const target = parts.at(-1)!;
                if (!isNameExpression(target) || locals.has(target.name)) return false;
                const helper = resolve(target.name);
                if (!helper || helper.parameters.length !== parts.length - 1) return false;
                const effects = analyze(target.name);
                if (effects.unknown || !parts.slice(0, -1).every(expression)) return false;
                // A helper capture could collide with a caller local. Fall back
                // rather than guessing which lexical binding the name denotes.
                for (const capture of effects.captures) {
                    if (locals.has(capture)) return false;
                    captures.add(capture);
                }
                for (const index of effects.parameters) {
                    let argument = parts[index];
                    while (isParenthesizedExpression(argument)) argument = argument.value;
                    if (!isNameExpression(argument) || !write(argument.name)) return false;
                }
                return true;
            }
            if (isNumberLiteral(value) || isStringLiteral(value) || isBooleanLiteral(value)
                || isLabelLiteral(value) || isTextBlockExpression(value)) return true;
            if (isParenthesizedExpression(value)) return expression(value.value);
            if (isUnaryExpression(value)) return expression(value.operand);
            if (isBinaryExpression(value)) return expression(value.left) && expression(value.right)
                && (!value.step || expression(value.step));
            if (isArrayExpression(value)) return [...value.items, ...value.dimensions, ...value.rows.flatMap(row => row.items)]
                .every(item => expression(item.value)) && (!value.fill || expression(value.fill));
            return false;
        };
        const statement = (item: Statement): boolean => {
            // Runtime assignment searches enclosing frames before making a local.
            if (isAssignmentStatement(item)) return item.operator === '=' && !item.name.includes('.')
                && (definition.parameters.includes(item.name) || definition.$container.$type === 'Program')
                && expression(item.value);
            if (isArrayAssignmentStatement(item)) return isPlainArrayWrite(item) && write(item.name) && expression(item.value)
                && item.indices.every(index => !index.value || expression(index.value));
            if (isExpressionStatement(item)) return expression(item.value);
            if (isReturnStatement(item)) return !item.value || expression(item.value);
            if (isIfStatement(item)) return expression(item.condition) && item.thenStatements.every(statement)
                && item.elifClauses.every(clause => expression(clause.condition) && clause.statements.every(statement))
                && item.elseStatements.every(statement);
            return false;
        };
        active.add(name);
        try {
            const result = definition.statements.every(statement) ? { unknown: false, parameters, captures } : unknown;
            cache.set(name, result);
            return result;
        } finally { active.delete(name); }
    }
    return analyze;
}

/** Numeric/whole-axis replacement cannot invoke a table field or container callback. */
export function isPlainArrayWrite(statement: ArrayAssignmentStatement): boolean {
    return statement.operator === '=' && statement.indices.every(index => !index.spread
        && (index.all || isNumberLiteral(index.value) && typeof index.value.value === 'bigint'));
}
