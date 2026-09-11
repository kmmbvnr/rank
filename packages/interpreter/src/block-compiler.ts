import { completed, type Evaluation, type Execution } from './execution.js';
import type { RankValue } from './value.js';

type Value = RankValue | undefined;
interface Context { readonly insideFinally: boolean; readonly insideGenerator: boolean }
interface Step<C> {
    readonly run?: (context: C) => Value;
    readonly stream?: (context: C) => Evaluation<Value>;
    readonly tensor?: { readonly count: number; run(): Value };
}
export type CompiledBlock<C> = (context: C, index?: number, previous?: Value) => Evaluation<Value>;
interface Host<C> {
    prepare(index: number): Step<C>;
    locate(error: unknown, index: number): unknown;
    pause(index: number, task: Execution<Value>, context: C, block: CompiledBlock<C>): Evaluation<Value>;
    compiled?(source: string): void;
    executed?(): void;
}
type Factory = (prepare: unknown, locate: unknown, complete: unknown, pause: unknown, entered: unknown) => unknown;
// Templates contain only command positions, never ASTs, values or environments.
const factories = new Map<number, { factory: Factory | null; source: string }>();

/** Straight-line dispatch with explicit re-entry points for suspended commands.
 * Preparation remains lazy; an unreachable statement is never prepared. */
export function compileBlock<C extends Context>(length: number, host: Host<C>): CompiledBlock<C> | undefined {
    if (length < 1 || length > 64) return undefined;
    let template = factories.get(length);
    if (!template) {
        const cases = Array.from({ length }, (_, index) => `case ${index}: {
            index = ${index};
            const step = s${index} ??= prepare(${index});
            if (step.tensor && !context.insideFinally && !context.insideGenerator) {
                const value = step.tensor.run();
                if (value !== undefined) { result = value; index += step.tensor.count; continue; }
            }
            if (step.run) result = step.run(context);
            else {
                const task = step.stream(context);
                if (task.done) result = task.value;
                else return pause(index, task, context, run);
            }
        }`).join('\n');
        const source = `"use strict"; let ${Array.from({ length }, (_, i) => `s${i}`).join(',')};
            return function run(context, index = 0, result) {
                if (entered) entered();
                try {
                    while (index < ${length}) {
                        switch (index) { ${cases}\n }
                        break;
                    }
                    return complete(result);
                } catch (error) { throw locate(error, index); }
            };`;
        let factory: Factory | null;
        try { factory = new Function('prepare', 'locate', 'complete', 'pause', 'entered', source) as Factory; }
        catch { factory = null; }
        template = { factory, source };
        // A CSP rejection is local to this attempt; another interpreter may run
        // under a different host policy. Its own block cache retains the fallback.
        if (factory) factories.set(length, template);
    }
    if (!template.factory) return undefined;
    host.compiled?.(template.source);
    return template.factory(host.prepare, host.locate, completed, host.pause, host.executed) as CompiledBlock<C>;
}
