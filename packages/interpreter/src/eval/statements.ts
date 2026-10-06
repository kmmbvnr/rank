import {
    applicationForm, isApplicationExpression, isArgsStatement, isArgumentStatement,
    isArrayAssignmentStatement, isAssignmentStatement, isBreakStatement, isContinueStatement, isExpressionStatement,
    isFlagStatement, isForStatement, isFunctionStatement, isFunctionBindingStatement, isIfStatement,
    isNameExpression, isOptionStatement, isParenthesizedExpression, isPushStatement, isReturnStatement,
    isRunStatement, isTestStatement, isTryStatement, isUnpackStatement, isUseStatement, isYieldStatement,
    type Expression, type FunctionBindingStatement, type FunctionStatement, type Operation, type Statement,
} from '@arrrank/language';
import type { BindingEnvironment } from '../binding-environment.js';
import { inputDeclarationName } from '../cli-args.js';
import { BREAK_SIGNAL, CONTINUE_SIGNAL, ReturnSignal } from '../control-signals.js';
import { RankError } from '../errors.js';
import { emit, mapExecution, mapResult, resume, type Evaluation, type Execution } from '../execution.js';
import {
    prepareIfStatement, prepareTryStatement, type ExecutionContext, type PreparedStatement,
} from '../statement-control.js';
import { formatValue, isRankArray, type RankValue } from '../value.js';
import {
    prepareArrayAssignment, prepareAssignment, prepareCollectionMutation,
    preparePushStatement, prepareUnpackStatement, type AssignmentContext,
} from './assignments.js';
import { prepareForStatement, type LoopContext } from './loops.js';

/** Program-level statements: modules, runs, tests and command-line arguments. */
export interface ProgramControl {
    useFile(path: string, alias?: string): void;
    useStandard(module: string): void;
    run(path?: string): RankValue | undefined;
    runAlias(alias: string): RankValue | undefined;
    test(name: string, statements: Statement[]): void;
    /** The arguments the next `run` passes to its program. */
    setArguments(values: string[]): void;
}

/** What preparing a statement needs beyond the loop and write owners. */
export interface StatementContext {
    readonly bindings: BindingEnvironment;
    evaluate(expression: Expression): Evaluation<RankValue>;
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    /** Evaluation of a returned application that may become a tail call. */
    compileTail(expression: Expression): () => Evaluation<RankValue>;
    operationOf(name: string): Operation | undefined | false;
    execute(statements: Statement[], context: ExecutionContext): Evaluation<RankValue | undefined>;
    assign(name: string, value: RankValue): void;
    define(statement: FunctionStatement): RankValue;
    defineBinding(statement: FunctionBindingStatement): RankValue;
    requireModule(module: string, operation: string): void;
    readonly program: ProgramControl;
    readonly loops: LoopContext;
    readonly writes: AssignmentContext;
}

/**
 * Prepares one statement for execution. Preparation caches only syntax:
 * flags and workspaces belong to each execution, including resumed
 * generators. A statement is prepared only when control reaches it.
 */
export function prepareStatement(statement: Statement, host: StatementContext): PreparedStatement {
    if (isUseStatement(statement)) {
        return { stream: function* (): Execution<RankValue | undefined> {
            if (statement.path !== undefined) {
                host.program.useFile(statement.path, statement.alias);
            } else {
                host.program.useStandard(statement.module!);
            }
            return undefined;
        } };
    }
    if (isRunStatement(statement)) {
        return { stream: function* (): Execution<RankValue | undefined> { return host.program.run(statement.path); } };
    }
    if (isArgsStatement(statement)) {
        return { stream: function* (): Execution<RankValue | undefined> {
            host.requireModule('cli', 'args');
            host.program.setArguments((yield* resume(mapExecution(statement.values, value => host.evaluate(value)))).map(formatValue));
            return undefined;
        } };
    }
    if (isOptionStatement(statement)
        || isArgumentStatement(statement)
        || isFlagStatement(statement)) {
        return { stream: function* (): Execution<RankValue | undefined> {
            host.requireModule('cli', inputDeclarationName(statement));
            return undefined;
        } };
    }
    if (isTestStatement(statement)) {
        return { stream: function* (): Execution<RankValue | undefined> {
            host.program.test(statement.description, statement.statements);
            return undefined;
        } };
    }
    if (isFunctionBindingStatement(statement)) return { run: () => host.defineBinding(statement) };
    if (isFunctionStatement(statement)) {
        return { stream: function* (): Execution<RankValue | undefined> { return host.define(statement); } };
    }
    if (isYieldStatement(statement)) {
            return { stream: function* (context) {
            const { insideGenerator } = context;
            if (!insideGenerator) {
                throw new RankError('yield is only valid inside a generator function');
            }
            yield* resume(emit((yield* resume(host.evaluate(statement.value)))));
            return undefined;
        } };
    }
    if (isReturnStatement(statement)) {
        const validate = (context: ExecutionContext): void => {
            const { insideFinally, insideGenerator } = context;
            if (insideFinally) {
                throw new RankError('return is not valid inside finally');
            }
            if (host.bindings.current === undefined) {
                throw new RankError('return is only valid inside a function');
            }
            if (insideGenerator && statement.value !== undefined) {
                throw new RankError('a generator cannot return a value');
            }
            if (!insideGenerator && statement.value === undefined) {
                throw new RankError('a value-returning function must return a value');
            }
        };
        const direct = statement.value && host.compileDirect(statement.value);
        if (direct) {
            return { run: context => {
                validate(context);
                throw new ReturnSignal(direct());
            } };
        }
        let candidate = statement.value;
        while (candidate && isParenthesizedExpression(candidate)) candidate = candidate.value;
        const tailCandidate = candidate && isApplicationExpression(candidate);
        if (!tailCandidate) {
            return { stream: function* (context): Execution<RankValue | undefined> {
                validate(context);
                throw new ReturnSignal(statement.value === undefined ? undefined
                    : yield* resume(host.evaluate(statement.value)));
            } };
        }
        let tail: (() => Evaluation<RankValue>) | undefined;
        return { stream: context => {
            validate(context);
            if (statement.value === undefined) throw new ReturnSignal();
            const result = context.tailCallsAllowed !== false
                ? (tail ??= host.compileTail(statement.value))()
                : host.evaluate(statement.value);
            return mapResult(result, value => { throw new ReturnSignal(value); });
        } };
    }
    if (isBreakStatement(statement) || isContinueStatement(statement)) {
        const operation = isBreakStatement(statement) ? 'break' : 'continue';
        const signal = operation === 'break' ? BREAK_SIGNAL : CONTINUE_SIGNAL;
        // Leaving an iteration never suspends, so it needs no task at all.
        return { run: (context): RankValue | undefined => {
            if (context.insideFinally) {
                throw new RankError(`${operation} is not valid inside finally`);
            }
            if (!context.insideLoop) {
                throw new RankError(`${operation} is only valid inside a for loop`);
            }
            if (context.loopControl) {
                context.loopControl.signal = operation;
                return undefined;
            }
            throw signal;
        } };
    }
    if (isTryStatement(statement) || isIfStatement(statement)) {
        const control = {
            evaluate: (expression: Expression) => host.evaluate(expression),
            execute: (statements: Statement[], context: ExecutionContext) => host.execute(statements, context),
            compileDirect: (expression: Expression) => host.compileDirect(expression),
            assign: (name: string, value: RankValue) => host.assign(name, value),
        };
        return isTryStatement(statement)
            ? prepareTryStatement(statement, control) : prepareIfStatement(statement, control);
    }
    if (isForStatement(statement)) return prepareForStatement(statement, host.loops);
    if (isPushStatement(statement)) return preparePushStatement(statement, host.writes);
    if (isUnpackStatement(statement)) return prepareUnpackStatement(statement, host.writes);
    if (isArrayAssignmentStatement(statement)) return prepareArrayAssignment(statement, host.writes);
    if (isAssignmentStatement(statement)) return prepareAssignment(statement, host.writes);
    if (isExpressionStatement(statement)) {
        const form = applicationForm(statement.value, name => host.operationOf(name), true);
        const mutation = form.kind === 'collection-mutation' ? form : undefined;
        if (mutation) return prepareCollectionMutation(mutation, host.writes);
        if (isNameExpression(statement.value) && statement.value.name.endsWith('.run')) {
            const alias = statement.value.name.slice(0, -4);
            return { stream: function* (): Execution<RankValue | undefined> { return host.program.runAlias(alias); } };
        }
        const direct = host.compileDirect(statement.value);
        if (direct) {
            return { run: context => {
                const result = direct();
                if (context.assertBooleanExpressions) assertTestExpression(result);
                return result;
            } };
        }
        return { stream: context => mapResult(host.evaluate(statement.value), result => {
            if (context.assertBooleanExpressions) assertTestExpression(result);
            return result;
        }) };
    }
    return { stream: function* (): Execution<RankValue | undefined> { return undefined; } };
}

function assertTestExpression(value: RankValue): void {
    const failed = typeof value === 'boolean'
        ? !value
        : isRankArray(value)
            && value.items.every(item => typeof item === 'boolean')
            && value.items.some(item => item === false);
    if (failed) throw new RankError('boolean test expression evaluated to false');
}

type FunctionPlacement = 'top' | 'function' | 'block';

/** Functions are declared at top level or directly inside another function, never inside a block. */
export function validateFunctionPlacement(
    statements: readonly Statement[],
    placement: FunctionPlacement,
): void {
    for (const statement of statements) {
        if (isFunctionStatement(statement)) {
            if (placement === 'block') {
                throw new RankError('a local function must be declared directly inside a function');
            }
            validateFunctionPlacement(statement.statements, 'function');
        } else if (isTestStatement(statement)) {
            validateFunctionPlacement(statement.statements, 'top');
        } else if (isIfStatement(statement)) {
            validateFunctionPlacement(statement.thenStatements, 'block');
            for (const clause of statement.elifClauses) {
                validateFunctionPlacement(clause.statements, 'block');
            }
            validateFunctionPlacement(statement.elseStatements, 'block');
        } else if (isForStatement(statement)) {
            validateFunctionPlacement(statement.statements, 'block');
        } else if (isTryStatement(statement)) {
            validateFunctionPlacement(statement.statements, 'block');
            for (const clause of statement.catches) {
                validateFunctionPlacement(clause.statements, 'block');
            }
            validateFunctionPlacement(statement.finallyStatements, 'block');
        }
    }
}
