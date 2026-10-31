import { completed, type Evaluation, type Execution } from '../execution.js';
import type { RankValue } from '../value.js';

type Value = RankValue | undefined;
interface Context {
    readonly insideLoop?: boolean;
    readonly insideFinally: boolean;
    readonly insideGenerator: boolean;
    readonly loopControl?: { signal?: 'break' | 'continue' };
    readonly functionControl?: { returned?: boolean };
}
interface Step<C> {
    readonly run?: (context: C) => Value;
    readonly stream?: (context: C) => Evaluation<Value>;
    readonly tensor?: { run(): Value };
}
export type CompiledBlock<C> = (context: C, index?: number, previous?: Value) => Evaluation<Value>;
interface Host<C> {
    prepare(index: number): Step<C>;
    region?(index: number): { length: number; run(session?: object): Value } | undefined;
    locate(error: unknown, index: number): unknown;
    pause(index: number, task: Execution<Value>, context: C, block: CompiledBlock<C>): Evaluation<Value>;
    compiled?(source: string): void;
    executed?(): void;
}
/** Straight-line dispatch with explicit re-entry points for suspended commands.
 * Preparation remains lazy; an unreachable statement is never prepared. */
export function compileBlock<C extends Context>(length: number, host: Host<C>): CompiledBlock<C> | undefined {
    if (length < 1 || length > 64) return undefined;
    try { new Function(''); } catch { return undefined; }
    const steps: (Step<C> | undefined)[] = new Array(length);
    host.compiled?.('direct-step-dispatch');
    return function run(context: C, index = 0, result?: Value): Evaluation<Value> {
        if (host.executed) host.executed();
        try {
            while (index < length) {
                if (context.insideLoop && !context.insideFinally && !context.insideGenerator) {
                    const region = host.region?.(index);
                    const value = region?.run(context.loopControl);
                    if (value !== undefined) { result = value; index += region!.length; continue; }
                }
                const step = steps[index] ??= host.prepare(index);
                if (step.tensor && !context.insideFinally && !context.insideGenerator) {
                    const value = step.tensor.run();
                    if (value !== undefined) { result = value; index++; continue; }
                }
                if (step.run) {
                    result = step.run(context);
                } else if (step.stream) {
                    const task = step.stream(context);
                    if ('done' in task) result = task.value;
                    else return host.pause(index, task, context, run);
                }
                if (context.loopControl?.signal || context.functionControl?.returned) return completed(result);
                index++;
            }
            return completed(result);
        } catch (error) {
            throw host.locate(error, index);
        }
    };
}
