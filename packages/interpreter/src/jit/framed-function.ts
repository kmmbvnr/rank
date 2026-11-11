import { isIfStatement, isReturnStatement, isTryStatement, type Expression, type FunctionStatement, type Statement } from '@arrrank/language';
import { observeCompiler, observedRun, declineCompiler } from '../compiler-observation.js';
import { completed, resume, type Evaluation, type Execution } from '../execution.js';
import { currentDiagnostics, recordFallback } from '../diagnostics.js';
import { checkpoint, inspectionEnabled } from '../interrupt.js';
import { expectBoolean, type RankValue } from '../value.js';
import type { ExecutionContext, PreparedStatement } from '../statement-control.js';
import type { CompiledBlock } from './block-compiler.js';

import type { ScalarRegion } from './scalar-region.js';

type Value = RankValue | undefined;
type Block = (context: ExecutionContext, value?: Value) => Evaluation<Value>;
interface Host {
    region?(statements: Statement[], index: number): ScalarRegion | undefined;
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

// Each generated fragment and the number retained by an owner stay bounded.
// After the cache fills, checked statement dispatch handles the remaining
// fragments without generating and evicting code on every invocation.
function partitionedBody(commands: Statement[], host: Host, backend: string): CompiledBlock<ExecutionContext> {
    const parts = new Map<number, CompiledBlock<ExecutionContext>>();
    function run(context: ExecutionContext, index = 0, value?: Value): Evaluation<Value> {
        while (index < commands.length) {
            checkpoint();
            if (context.functionControl?.returned || context.loopControl?.signal) return completed(value);
            const end = Math.min(index + 64, commands.length);
            let part = parts.get(index);
            if (!part && parts.size < 16) {
                const statements = commands.slice(index, end);
                part = compileFramedBody(statements, statements[0], host, backend, false);
                if (part) parts.set(index, part);
            }
            if (!part) {
                if (parts.size >= 16) {
                    currentDiagnostics()?.compilerBudget('retained generated fragments', 16, parts.size + 1, 'checked statement dispatch with live bindings');
                    recordFallback(`${backend}:fragment-cache-budget:16`, 'cost');
                }
                // Keep completed work and live bindings. This shared tail does
                // not accumulate code for every possible fragment or frame.
                while (index < commands.length) {
                    try {
                        checkpoint();
                        const prepared = host.prepare(commands, index);
                        const task = 'run' in prepared ? completed(prepared.run(context)) : prepared.stream(context);
                        if (!('done' in task)) return continueAfter(task, context, index + 1);
                        value = task.value;
                        if (context.functionControl?.returned || context.loopControl?.signal) return completed(value);
                    } catch (error) { throw host.locate(error, commands[index]); }
                    index++;
                }
                return completed(value);
            }
            const task = part(context);
            if (!('done' in task)) return continueAfter(task, context, end);
            value = task.value;
            index = end;
        }
        return completed(value);
    }
    function* continueAfter(task: Execution<Value>, context: ExecutionContext, index: number): Execution<Value> {
        const value = yield* resume(task);
        return yield* resume(run(context, index, value));
    }
    return run;
}

function returns(commands: readonly Statement[], depth = 0): boolean {
    return depth <= 16 && commands.some(command => isReturnStatement(command)
        || isIfStatement(command) && returns(command.thenStatements, depth + 1) && returns(command.elseStatements, depth + 1)
            && command.elifClauses.every(clause => returns(clause.statements, depth + 1))
        || isTryStatement(command) && returns(command.statements, depth + 1)
            && command.catches.every(clause => returns(clause.statements, depth + 1)));
}

// Count only code that this backend inlines, stopping at its current budget.
function fitsBranches(command: Statement, budget: number): boolean {
    const pending = [command];
    while (pending.length) {
        const item = pending.pop()!;
        if (--budget < 0) return false;
        if (isIfStatement(item)) {
            budget -= item.elifClauses.length + 1;
            if (budget < 0) return false;
            if (item.thenStatements.length + item.elseStatements.length > budget) return false;
            pending.push(...item.thenStatements, ...item.elseStatements);
            for (const branch of item.elifClauses) {
                if (pending.length + branch.statements.length > budget) return false;
                pending.push(...branch.statements);
            }
        }
    }
    return true;
}

function compileFramedBody(commands: Statement[], statement: Statement, host: Host, backend: string, requireReturn: boolean): CompiledBlock<ExecutionContext> | undefined {
    return observeCompiler(statement, backend, 'prepare', () => {
        if (inspectionEnabled()) return declineCompiler('inspection-enabled', statement);
        if (requireReturn && !returns(commands)) return declineCompiler('terminal-return-required', statement);
        if (commands.length > 256) {
            currentDiagnostics()?.compilerBudget('statements per generated region', 256, commands.length, 'lazy fragments of at most 64 statements');
            try { new Function(''); } catch { return declineCompiler('dynamic-code-unavailable', statement); }
            return observedRun(statement, backend, partitionedBody(commands, host, backend), undefined, true);
        }
        const sites: Statement[] = [], leaves: { statements: Statement[]; index: number }[] = [];
        const conditions: Expression[] = [], scopes: { statement: Statement; entry: string }[] = [];
        const functions: string[] = [];
        const regions: ScalarRegion[] = [];
        // The call driver and delegated loops retain polling. Generated control
        // is acyclic and bounded, just like the existing block dispatcher.
        let budget = 256, serial = 0;
        function emit(body: string, location: number): string {
            const name = `node${serial++}`;
            functions.push(`function ${name}(context, value) { try { ${body} }
                catch (error) { throw locate(error, ${location}); } }`);
            return name;
        }
        function linearBlock(commands: Statement[]): string {
            const name = `node${serial++}`, cases: string[] = [];
            let regionEnd = 0;
            for (let index = 0; index < commands.length; index++) {
                if (--budget < 0) throw new Error('budget');
                const location = sites.push(commands[index]) - 1;
                const leaf = leaves.push({ statements: commands, index }) - 1;
                const next = `(context, value) => context.functionControl?.returned || context.loopControl?.signal
                    ? completed(value) : ${name}(context, value, ${index + 1})`;
                const region = index >= regionEnd ? host.region?.(commands, index) : undefined;
                let fused = '';
                if (region) {
                    regionEnd = index + region.length;
                    const slot = regions.push(region) - 1;
                    fused = `const fused = regions[${slot}].run();
                        if (fused !== undefined) return ${name}(context, fused, ${regionEnd});`;
                }
                cases.push(`case ${index}: {
                    ${fused}
                    location = ${location};
                    const task = step(${leaf}, context);
                    if (!('done' in task)) return suspend(task, context, ${next}, location);
                    value = task.value;
                    if (context.functionControl?.returned || context.loopControl?.signal) return completed(value);
                }`);
            }
            // Fallthrough retains one JavaScript frame for the synchronous
            // fragment. A suspended command resumes at its following case.
            functions.push(`function ${name}(context, value, start = 0) {
                let location = 0;
                try { switch (start) { ${cases.join('\n')} } return completed(value); }
                catch (error) { throw locate(error, location); }
            }`);
            return name;
        }
        function block(commands: Statement[], depth = 0): string {
            if (commands.length >= 16 && commands.every(command => !isIfStatement(command))) return linearBlock(commands);
            let next = 'end';
            for (let index = commands.length - 1; index >= 0; index--) {
                if (--budget < 0) throw new Error('budget');
                const command = commands[index], location = sites.push(command) - 1;
                let evaluate: string;
                if (isIfStatement(command) && depth < 16 && fitsBranches(command, budget - index)) {
                    let otherwise = block(command.elseStatements, depth + 1);
                    const branches = [{ condition: command.condition, statements: command.thenStatements }, ...command.elifClauses];
                    budget -= branches.length;
                    for (const branch of branches.reverse()) {
                        const condition = conditions.push(branch.condition) - 1, taken = block(branch.statements, depth + 1);
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
                        return 'done' in task ? task : suspend(task, context, undefined, ${location});`, location);
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
        catch { return observedRun(statement, backend, partitionedBody(commands, host, backend), undefined, true); }
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
        const suspend = function* (task: Execution<Value>, context: ExecutionContext, next: Block | undefined, location: number): Execution<Value> {
            try {
                const value = (yield { task }) as Value;
                if (!next) return value;
                const result = next(context, value);
                return 'done' in result ? result.value : (yield { task: result }) as Value;
            } catch (error) { throw host.locate(error, sites[location]); }
        };
        try {
            const run = new Function('regions', 'step', 'test', 'scope', 'completed', 'suspend', 'expectBoolean', 'locate', 'executed', source)(
                regions, step, test, (run: Block, index: number) => {
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
