import type { Expression, Statement } from '@arrrank/language';
import { currentDiagnostics, type CompilerObservation, type CompilerAttempt, type CompilerExecutionKind } from './diagnostics.js';
import { describeCompilerRejection } from './compiler-rejection.js';

type Site = Expression | Statement;

const compiledBackends = new Set([
    'scalar-expression', 'resumable-scalar-expression', 'scalar-function', 'scalar-function-direct',
    'scalar-function-number', 'exact-loop', 'number-loop', 'mixed-loop', 'numeric-call-loop',
    'numeric-function', 'integer-array-function', 'real-array-function', 'generator-loop',
    'tensor', 'tensor-reduction', 'tensor-region', 'array-region', 'number-tensor',
    'layout-number-tensor', 'bounded-tensor', 'tensor-cell-copy', 'fused-arithmetic-reader',
    'computed-array-update', 'flat-combine', 'native-tensor-reduction', 'native-tensor-axis',
    'native-tensor-copy', 'native-tensor-visit', 'native-integer-scan',
]);
function finishExecution(attempt: CompilerAttempt): CompilerObservation['execution'] {
    let own: CompilerExecutionKind | undefined;
    if (compiledBackends.has(attempt.backend)) own = 'compiled';
    else if (attempt.backend.startsWith('native-') || attempt.backend === 'host-call') own = 'native';
    else if (attempt.backend === 'interpreted-loop' || attempt.backend === 'ordinary-fold') own = 'interpreted';
    // Expression/statement dispatch alone proves ordinary execution, not JIT work.
    else if (!attempt.executionKinds?.size && ['direct-expression', 'interpreted-expression', 'statement-dispatch'].includes(attempt.backend)) own = 'interpreted';
    if (own) {
        (attempt.executionKinds ??= new Set()).add(own);
        (attempt.executionPaths ??= new Set()).add(attempt.backend);
    }
    attempt.completed = true;
    return { kinds: [...attempt.executionKinds ?? []].sort(), paths: [...attempt.executionPaths ?? []].sort() };
}

/** An observation never evaluates a value or installs a compiler hook. */
export function observeCompiler<T>(
    site: Site | undefined, backend: string, phase: CompilerObservation['phase'], run: () => T,
    provenTypes?: Readonly<Record<string, string>>, suspending = false, emptyResult: 'decline' | 'success' = 'decline',
): T {
    const diagnostics = currentDiagnostics();
    if (!diagnostics?.traceCompiler || !site) return run();
    const { reason: _reason, ...source } = describeCompilerRejection(backend, site);
    return observeCompilerSource(source, backend, phase, run, provenTypes, suspending, emptyResult);
}

export function observeCompilerSource<T>(
    source: CompilerObservation['source'], backend: string, phase: CompilerObservation['phase'], run: () => T,
    provenTypes?: Readonly<Record<string, string>>, suspending = false, emptyResult: 'decline' | 'success' = 'decline',
): T {
    const diagnostics = currentDiagnostics();
    if (!diagnostics?.traceCompiler) return run();
    const attempt: CompilerAttempt = { source, backend, phase, provenTypes, reasons: new Set() };
    return diagnostics.compilerScope(attempt, () => {
        try {
            const result = run();
            const outcome = emptyResult === 'decline' && (result === undefined || result === null) ? 'declined' : phase === 'prepare' ? 'prepared' : 'selected';
            if (suspending && phase === 'execute' && result && typeof result === 'object'
                && 'next' in result && typeof result.next === 'function'
                && Symbol.iterator in result) {
                diagnostics.observeCompiler({ ...attempt, reasons: [...attempt.reasons], outcome });
                const wrap = (iterator: Generator<unknown, unknown, unknown>, root = false): Generator<unknown, unknown, unknown> => {
                    let started = false, finished = false;
                    const resume = (step: () => IteratorResult<unknown>) => diagnostics.run(() =>
                        diagnostics.compilerScope(attempt, () => {
                            try {
                                const next = step();
                                // The execution driver resumes child tasks outside the parent's next().
                                // Carry the source across that boundary without keeping a global scope open.
                                if (!next.done && next.value && typeof next.value === 'object' && 'task' in next.value) {
                                    const request = next.value as { task: Generator<unknown, unknown, unknown> };
                                    return { done: false, value: { task: wrap(request.task) } };
                                }
                                if (next.done && root && started && !finished) {
                                    finished = true;
                                    diagnostics.observeCompiler({ ...attempt, reasons: [...attempt.reasons],
                                        outcome: 'completed', execution: finishExecution(attempt) });
                                }
                                return next;
                            } catch (error) {
                                diagnostics.observeCompiler({ ...attempt, reasons: [...attempt.reasons], outcome: 'threw' });
                                throw error;
                            }
                        }));
                    return {
                        next: (value?: unknown) => { started = true; return resume(() => iterator.next(value)); },
                        throw: (error?: unknown) => resume(() => iterator.throw(error)),
                        return: (value?: unknown) => resume(() => iterator.return(value)),
                        [Symbol.iterator]() { return this; },
                    } as Generator<unknown, unknown, unknown>;
                };
                return wrap(result as unknown as Generator<unknown, unknown, unknown>, true) as unknown as T;
            }
            diagnostics.observeCompiler({ ...attempt, reasons: [...attempt.reasons], outcome,
                execution: phase === 'execute' && outcome === 'selected' ? finishExecution(attempt) : undefined });
            return result;
        } catch (error) {
            diagnostics.observeCompiler({ ...attempt, reasons: [...attempt.reasons], outcome: 'threw' });
            throw error;
        }
    });
}

/** A prepared candidate keeps its source when its entry guards run later. */
export function observedRun<A extends unknown[], T>(
    site: Site, backend: string, run: (...args: A) => T,
    provenTypes?: Readonly<Record<string, string>>, suspending = false, emptyResult: 'decline' | 'success' = 'decline',
): (...args: A) => T {
    return (...args) => currentDiagnostics()?.traceCompiler
        ? observeCompiler(site, backend, 'execute', () => run(...args), provenTypes, suspending, emptyResult)
        : run(...args);
}

/** Name a deliberate frontend boundary without evaluating its rejected operands. */
export function declineCompiler(reason: string, site?: Site): undefined {
    const diagnostics = currentDiagnostics();
    if (diagnostics) diagnostics.compilerDecline(reason, site && describeCompilerRejection('compiler', site));
    return undefined;
}

/** Entry guards can run outside the candidate's generated function. */
export function rejectCompilerGuard(site: Site, backend: string, reason: string): false {
    if (currentDiagnostics()?.traceCompiler) {
        observeCompiler(site, backend, 'execute', () => declineCompiler(reason));
    }
    return false;
}

/** IR-only backends inherit the syntax owner of the demand that selected them. */
export function compilerSource(): CompilerObservation['source'] {
    return currentDiagnostics()?.currentCompilerSource ?? { node: 'NativeDemand', operation: 'native demand' };
}

export function observedSourceRun<A extends unknown[], T>(
    source: CompilerObservation['source'], backend: string, run: (...args: A) => T,
    provenTypes?: Readonly<Record<string, string>>,
): (...args: A) => T {
    return (...args) => currentDiagnostics()?.traceCompiler
        ? observeCompilerSource(source.node === 'NativeDemand' ? compilerSource() : source, backend, 'execute', () => run(...args), provenTypes)
        : run(...args);
}

export function withCompilerSource<T>(site: Site, run: () => T): T {
    const diagnostics = currentDiagnostics();
    if (!diagnostics?.traceCompiler) return run();
    const { reason: _reason, ...source } = describeCompilerRejection('dispatch', site);
    return diagnostics.compilerScope({ source, backend: 'dispatch', phase: 'execute', reasons: new Set() }, run);
}

/** Keep live getters (notably generated source) and the candidate's prototype. */
export function withCompilerMethods<T extends object>(candidate: T, methods: Partial<T>): T {
    return Object.create(Object.getPrototypeOf(candidate), {
        ...Object.getOwnPropertyDescriptors(candidate), ...Object.getOwnPropertyDescriptors(methods),
    }) as T;
}
