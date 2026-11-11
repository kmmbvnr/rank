import { isIfStatement, isReturnStatement, type Expression, type FunctionStatement, type Statement } from '@arrrank/language';
import { observeCompiler, observedRun, declineCompiler } from '../compiler-observation.js';
import { completed, resume, type Evaluation } from '../execution.js';
import { inspectionEnabled } from '../interrupt.js';
import { expectBoolean, type RankValue } from '../value.js';
import type { ExecutionContext, PreparedStatement } from '../statement-control.js';
import type { CompiledBlock } from './block-compiler.js';

type Value = RankValue | undefined;
type Block = (context: ExecutionContext, value?: Value) => Evaluation<Value>;
interface Host {
    prepare(statements: Statement[], index: number): PreparedStatement;
    scope(statement: Statement, prepared: PreparedStatement): PreparedStatement;
    direct(expression: Expression): (() => RankValue) | undefined;
    evaluate(expression: Expression): Evaluation<RankValue>;
    locate(error: unknown, statement: Statement): unknown;
    compiled?(source: string): void;
    executed?(): void;
}

/** Compile control flow while keeping runtime frames, contracts and resumable callouts.
 * No return-type assumption or call-graph expansion is needed at a call boundary. */
export function compileFramedFunction(statement: FunctionStatement, host: Host): CompiledBlock<ExecutionContext> | undefined {
    return compileFramedBody(statement.statements, statement, host, 'framed-function', true);
}

/** A general loop's body can retain generated control around structured callouts. */
export function compileValueBlock(statements: Statement[], host: Host): CompiledBlock<ExecutionContext> | undefined {
    if (!statements.length) return undefined;
    return compileFramedBody(statements, statements[0], host, 'value-block', false);
}

function compileFramedBody(commands: Statement[], statement: Statement, host: Host, backend: string, requireReturn: boolean): CompiledBlock<ExecutionContext> | undefined {
    return observeCompiler(statement, backend, 'prepare', () => {
        if (inspectionEnabled()) return declineCompiler('inspection-enabled', statement);
        const sites: Statement[] = [], leaves: { statements: Statement[]; index: number }[] = [];
        const conditions: Expression[] = [], scopes: { statement: Statement; entry: string }[] = [];
        const functions: string[] = [];
        // The call driver and delegated loops retain polling. Generated control
        // is acyclic and bounded, just like the existing block dispatcher.
        let budget = 256, serial = 0;
        function emit(body: string, location: number): string {
            const name = `node${serial++}`;
            functions.push(`function ${name}(context, value) { try { ${body} }
                catch (error) { throw locate(error, ${location}); } }`);
            return name;
        }
        function block(commands: Statement[]): string {
            let next = 'end';
            for (let index = commands.length - 1; index >= 0; index--) {
                if (--budget < 0) throw new Error('budget');
                const command = commands[index], location = sites.push(command) - 1;
                let evaluate: string;
                if (isIfStatement(command)) {
                    let otherwise = block(command.elseStatements);
                    const branches = [{ condition: command.condition, statements: command.thenStatements }, ...command.elifClauses];
                    for (const branch of branches.reverse()) {
                        const condition = conditions.push(branch.condition) - 1, taken = block(branch.statements);
                        const choose = `(context, value) => expectBoolean(value) ? ${taken}(context) : ${otherwise}(context)`;
                        otherwise = emit(`const task = test(${condition});
                            if (typeof task === 'boolean') return task ? ${taken}(context) : ${otherwise}(context);
                            return suspend(task, context, ${choose}, ${location});`, location);
                    }
                    const scope = scopes.push({ statement: command, entry: otherwise }) - 1;
                    evaluate = `scoped[${scope}](context)`;
                } else {
                    const leaf = leaves.push({ statements: commands, index }) - 1;
                    evaluate = `step(${leaf}, context)`;
                }
                if (next === 'end') {
                    next = emit(`const task = ${evaluate};
                        return 'done' in task ? task : suspend(task, context, end, ${location});`, location);
                    continue;
                }
                const continuation = `(context, value) => context.functionControl?.returned || context.loopControl?.signal ? completed(value) : ${next}(context, value)`;
                next = emit(`const task = ${evaluate};
                    if (!('done' in task)) return suspend(task, context, ${continuation}, ${location});
                    return context.functionControl?.returned || context.loopControl?.signal
                        ? task : ${next}(context, task.value);`, location);
            }
            return next;
        }
        let entry: string;
        try { entry = block(commands); }
        catch { return declineCompiler('statement-budget', statement); }
        // Code generation already bounded the tree; this check cannot walk an unbounded graph.
        const returns = (commands: readonly Statement[]): boolean => commands.some(command => isReturnStatement(command)
            || isIfStatement(command) && returns(command.thenStatements) && returns(command.elseStatements)
                && command.elifClauses.every(clause => returns(clause.statements)));
        if (requireReturn && !returns(commands)) return declineCompiler('terminal-return-required', statement);
        const source = `"use strict"; ${functions.join('\n')}
            function end(context, value) { return completed(value); }
            const scoped = [${scopes.map(scope => scope.entry).join(',')}].map(scope);
            return function(context) { executed(); return ${entry}(context); };`;
        const prepared: (PreparedStatement | undefined)[] = [];
        const tests: ((() => RankValue) | null | undefined)[] = [];
        const step = (index: number, context: ExecutionContext): Evaluation<Value> => {
            const { statements, index: position } = leaves[index];
            const selected = prepared[index] ??= host.prepare(statements, position);
            if (selected.tensor && !context.insideFinally && !context.insideGenerator) {
                const value = selected.tensor.run();
                if (value !== undefined) return completed(value);
            }
            return 'run' in selected ? completed(selected.run(context)) : selected.stream(context);
        };
        const test = (index: number): boolean | Exclude<Evaluation<RankValue>, { done: true }> => {
            const direct = tests[index] === undefined ? tests[index] = host.direct(conditions[index]) ?? null : tests[index];
            if (direct) return expectBoolean(direct());
            const task = host.evaluate(conditions[index]);
            return 'done' in task ? expectBoolean(task.value) : task;
        };
        // Only an actual suspension allocates a task. Ordinary branches and tail
        // transfers stay synchronous, using the existing function-call trampoline.
        const suspend = function* (task: Evaluation<Value>, context: ExecutionContext, next: Block, location: number) {
            try { return yield* resume(next(context, yield* resume(task))); }
            catch (error) { throw host.locate(error, sites[location]); }
        };
        try {
            const run = new Function('step', 'test', 'scope', 'completed', 'suspend', 'expectBoolean', 'locate', 'executed', source)(
                step, test, (run: Block, index: number) => {
                    const scoped = host.scope(scopes[index].statement, { stream: run });
                    return 'stream' in scoped ? scoped.stream : (context: ExecutionContext) => completed(scoped.run(context));
                }, completed, suspend, expectBoolean,
                (error: unknown, index: number) => host.locate(error, sites[index]), () => host.executed?.(),
            ) as CompiledBlock<ExecutionContext>;
            host.compiled?.(source);
            return observedRun(statement, backend, run, undefined, true);
        } catch { return declineCompiler('dynamic-code-unavailable', statement); }
    });
}
