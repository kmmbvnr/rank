import { type Expression, type IfStatement, type Statement, type TryStatement } from '@arrrank/language';
import { resume, type Evaluation, type Execution } from './execution.js';
import { InterruptedError } from './interrupt.js';
import { RankError } from './errors.js';
import { expectBoolean, type RankValue } from './value.js';

export interface LoopControl { signal?: 'break' | 'continue' }

export interface ExecutionContext {
    readonly loopControl?: LoopControl;
    readonly assertBooleanExpressions: boolean;
    readonly insideLoop: boolean;
    readonly insideFinally: boolean;
    readonly insideGenerator: boolean;
    readonly tailCallsAllowed?: false;
}

/** A run of statements one tensor kernel computes at once; `run` answers undefined to fall back. */
export interface TensorGroup { readonly count: number; run(): RankValue | undefined }

/**
 * A statement ready to execute. `run` never suspends; `stream` may hand a task
 * to the driver. A statement that opens a fusable run also carries its group.
 */
export type PreparedStatement = (
    | { readonly run: (context: ExecutionContext) => RankValue | undefined }
    | { readonly stream: (context: ExecutionContext) => Evaluation<RankValue | undefined> }
) & { readonly tensor?: TensorGroup };

interface StatementExecution {
    execute(statements: Statement[], context: ExecutionContext): Evaluation<RankValue | undefined>;
}

interface TryControl extends StatementExecution {
    assign(name: string, value: RankValue): void;
}

interface IfControl extends StatementExecution {
    evaluate(expression: Expression): Evaluation<RankValue>;
    compileDirect(expression: Expression): (() => RankValue) | undefined;
}

/** The try boundary owns catch selection, finally execution and error precedence. */
export function prepareTryStatement(statement: TryStatement, control: TryControl) {
    return { stream: function* (context: ExecutionContext): Execution<RankValue | undefined> {
        let result: RankValue | undefined;
        let pending: unknown;
        const nested = { ...context, tailCallsAllowed: false as const, loopControl: undefined };
        try {
            try {
                try {
                    result = yield* resume(control.execute(statement.statements, nested));
                } catch (error) {
                    if (!(error instanceof RankError) || error instanceof InterruptedError) throw error;
                    const clause = statement.catches.find(candidate =>
                        candidate.errorKind === undefined || candidate.errorKind.name === error.rankKind);
                    if (!clause) throw error;
                    control.assign(clause.errorName, error.toValue());
                    result = yield* resume(control.execute(clause.statements, nested));
                }
            } catch (error) {
                pending = error;
            }
        } finally {
            try {
                yield* resume(control.execute(statement.finallyStatements, { ...nested, insideFinally: true }));
            } catch (error) {
                if (error instanceof RankError && pending instanceof RankError) error.attachCause(pending);
                pending = error;
            }
            if (pending !== undefined) throw pending;
        }
        return result;
    } };
}

/** A completed condition enters its branch directly; only suspension needs a task. */
export function prepareIfStatement(statement: IfStatement, control: IfControl) {
    const tests = [statement.condition, ...statement.elifClauses.map(clause => clause.condition)];
    const conditions = tests.map(condition => control.compileDirect(condition));
    const branchAt = (index: number) => index < 0 ? statement.elseStatements
        : index === 0 ? statement.thenStatements : statement.elifClauses[index - 1].statements;
    const enter = (context: ExecutionContext, index: number) => control.execute(branchAt(index), context);
    if (conditions.every(condition => condition !== undefined)) {
        return { stream: (context: ExecutionContext) => {
            for (let index = 0; index < conditions.length; index += 1) {
                if (expectBoolean(conditions[index]!())) return enter(context, index);
            }
            return enter(context, -1);
        } };
    }
    const suspended = function* (
        context: ExecutionContext, index: number, pending: Execution<RankValue>,
    ): Execution<RankValue | undefined> {
        let taken = expectBoolean(yield* resume(pending)) ? index : -1;
        for (index += 1; taken < 0 && index < tests.length; index += 1) {
            if (expectBoolean(yield* resume(control.evaluate(tests[index])))) taken = index;
        }
        return yield* resume(enter(context, taken));
    };
    return { stream: (context: ExecutionContext): Evaluation<RankValue | undefined> => {
        for (let index = 0; index < tests.length; index += 1) {
            const task = control.evaluate(tests[index]);
            if (!('done' in task)) return suspended(context, index, task);
            if (expectBoolean(task.value)) return enter(context, index);
        }
        return enter(context, -1);
    } };
}
