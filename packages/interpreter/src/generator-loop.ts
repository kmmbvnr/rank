import { isIfStatement, isYieldStatement, type Expression, type Statement } from '@arrrank/language';
import { BreakSignal, ContinueSignal } from './control-signals.js';
import { currentDiagnostics } from './diagnostics.js';
import type { Evaluation, Execution } from './execution.js';
import { checkpoint } from './interrupt.js';
import type { ExecutionContext, PreparedStatement } from './statement-control.js';
import { expectBoolean, type RankValue } from './value.js';

interface Host {
    evaluate(expression: Expression): Evaluation<RankValue>;
    compileDirect(expression: Expression): (() => RankValue) | undefined;
    prepare(statements: Statement[], index: number): PreparedStatement;
    locate(error: unknown, statement: Statement): unknown;
    compiled?(source: string): void;
    executed?(): void;
}

export type GeneratorLoop = (
    entries: Iterable<RankValue>, bind: (value: RankValue, ordinal: bigint) => void,
    context: ExecutionContext,
) => Execution<RankValue | undefined>;

/** Compile the control flow of a suspending loop, keeping values in their Rank
 * bindings rather than private registers or raw array buffers. Readers and
 * ordinary prepared writes observe the current state on every resume.
 * Nested loops and protected blocks retain their own scopes and unwinding. */
export function compileGeneratorLoop(statements: Statement[], host: Host): GeneratorLoop | undefined {
    const suspends = (commands: Statement[], depth = 0): boolean => depth <= 16 && commands.some(command => isYieldStatement(command)
        || isIfStatement(command) && [command.thenStatements, command.elseStatements,
            ...command.elifClauses.map(branch => branch.statements)].some(branch => suspends(branch, depth + 1)));
    if (!suspends(statements)) return undefined;
    const sites: Statement[] = [];
    const readers: (() => Evaluation<RankValue>)[] = [];
    const steps: (() => PreparedStatement)[] = [];
    function read(expression: Expression): string {
        const index = readers.length;
        let direct: (() => RankValue) | undefined;
        let prepared = false;
        readers.push(() => {
            if (!prepared) { direct = host.compileDirect(expression); prepared = true; }
            return direct ? { done: true, value: direct() } : host.evaluate(expression);
        });
        return `(pending = readers[${index}](), pending.done ? pending.value : (yield { task: pending }))`;
    }
    function body(commands: Statement[], depth: number): string | undefined {
        if (depth > 16) return undefined;
        const lines: string[] = ['result = undefined;'];
        for (let index = 0; index < commands.length; index++) {
            if (sites.length >= 128) return undefined;
            const command = commands[index], site = sites.length;
            sites.push(command);
            lines.push(`site = ${site}; checkpoint();`);
            if (isIfStatement(command)) {
                const branches = [{ condition: command.condition, statements: command.thenStatements }, ...command.elifClauses];
                for (let branch = 0; branch < branches.length; branch++) {
                    const code = body(branches[branch].statements, depth + 1);
                    if (code === undefined) return undefined;
                    lines.push(`${branch ? 'else ' : ''}if (expectBoolean(${read(branches[branch].condition)})) { ${code} }`);
                }
                const otherwise = body(command.elseStatements, depth + 1);
                if (otherwise === undefined) return undefined;
                lines.push(`else { ${otherwise} }`);
            } else if (isYieldStatement(command)) {
                lines.push(`yield { value: ${read(command.value)} }; result = undefined;`);
            } else {
                const step = steps.length;
                let prepared: PreparedStatement | undefined;
                steps.push(() => prepared ??= host.prepare(commands, index));
                lines.push(`{
                    const step = steps[${step}]();
                    if (step.run) result = step.run(context);
                    else {
                        pending = step.stream(context);
                        result = pending.done ? pending.value : (yield { task: pending });
                    }
                    if (context.loopControl.signal) {
                        const signal = context.loopControl.signal;
                        context.loopControl.signal = undefined;
                        if (signal === 'break') break iterations;
                        continue iterations;
                    }
                }`);
            }
        }
        return lines.join('\n');
    }
    const code = body(statements, 0);
    if (code === undefined) return undefined;
    const source = `"use strict";
        return function* (entries, bind, outer) {
            const context = { ...outer, insideLoop: true, tailCallsAllowed: false, loopControl: {} };
            let ordinal = 0n, result, pending, site = 0;
            entered();
            iterations: for (const entry of entries) {
                checkpoint();
                bind(entry, ordinal++);
                try { ${code} }
                catch (error) {
                    if (error instanceof BreakSignal) break;
                    if (error instanceof ContinueSignal) continue;
                    throw locate(error, site);
                }
            }
            return result;
        };`;
    let factory: Function;
    try {
        factory = new Function('readers', 'steps', 'checkpoint', 'expectBoolean', 'locate', 'entered',
            'BreakSignal', 'ContinueSignal', source);
    } catch { return undefined; }
    host.compiled?.(source);
    return factory(readers, steps, checkpoint, expectBoolean,
        (error: unknown, site: number) => host.locate(error, sites[site]),
        () => {
            host.executed?.();
            const diagnostics = currentDiagnostics();
            if (diagnostics) diagnostics.compiledGeneratorLoops++;
        }, BreakSignal, ContinueSignal) as GeneratorLoop;
}
