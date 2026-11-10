import type { Expression, Statement } from '@arrrank/language';
import { currentDiagnostics, type CompilerObservation, type CompilerAttempt } from './diagnostics.js';
import { describeCompilerRejection } from './compiler-rejection.js';

type Site = Expression | Statement;

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
            diagnostics.observeCompiler({ ...attempt, reasons: [...attempt.reasons], outcome });
            if (suspending && phase === 'execute' && result && typeof result === 'object'
                && 'next' in result && typeof result.next === 'function'
                && Symbol.iterator in result) {
                const wrap = (iterator: Generator<unknown, unknown, unknown>): Generator<unknown, unknown, unknown> => {
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
                                return next;
                            } catch (error) {
                                diagnostics.observeCompiler({ ...attempt, reasons: [...attempt.reasons], outcome: 'threw' });
                                throw error;
                            }
                        }));
                    return {
                        next: (value?: unknown) => resume(() => iterator.next(value)),
                        throw: (error?: unknown) => resume(() => iterator.throw(error)),
                        return: (value?: unknown) => resume(() => iterator.return(value)),
                        [Symbol.iterator]() { return this; },
                    } as Generator<unknown, unknown, unknown>;
                };
                return wrap(result as unknown as Generator<unknown, unknown, unknown>) as unknown as T;
            }
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
