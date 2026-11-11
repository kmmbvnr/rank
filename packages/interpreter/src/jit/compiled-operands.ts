import type { Expression, Statement } from '@arrrank/language';
import { observeCompiler, declineCompiler } from '../compiler-observation.js';
import { type Evaluation, type Execution } from '../execution.js';
import { currentDiagnostics } from '../diagnostics.js';
import { inspectionEnabled } from '../interrupt.js';

export interface Operand<T> {
    direct?: () => T;
    evaluate(): Evaluation<T>;
}

/** Lower ordered operand evaluation; only pending operands allocate a continuation.
 * Runtime adapters retain selector validation, ownership and effect contracts. */
export function compileOperands<T, R, C = undefined>(
    site: Expression | Statement, backend: string, operands: readonly Operand<T>[],
    apply: (values: T[], context: C) => Evaluation<R>, nativeBackend: string,
): ((context: C) => Evaluation<R>) | undefined {
    return observeCompiler(site, backend, 'prepare', () => {
        if (inspectionEnabled()) return declineCompiler('inspection-enabled', site);
        if (operands.length > 64) return declineCompiler('selector-budget', site);
        const finish = (values: T[], context: C) => currentDiagnostics()?.traceCompiler
            ? observeCompiler(site, nativeBackend, 'execute', () => apply(values, context), undefined, true)
            : apply(values, context);
        const direct = operands.map(operand => operand.direct);
        const readers = operands.map(operand => operand.evaluate);
        let source = '"use strict"; return function(context) {\n';
        if (direct.every(Boolean)) {
            source += `return apply([${direct.map((_, index) => `direct[${index}]()`).join(',')}], context);`;
        } else {
            source += 'const values = [];\n';
            for (let index = 0; index < operands.length; index++) {
                if (direct[index]) source += `values.push(direct[${index}]());\n`;
                else source += `const task${index} = readers[${index}]();
                    if (!('done' in task${index})) return suspend(task${index}, values, ${index + 1}, context);
                    values.push(task${index}.value);\n`;
            }
            source += 'return apply(values, context);';
        }
        source += '\n};';
        const suspend = function* (task: Execution<T>, values: T[], index: number, context: C): Execution<R> {
            values.push((yield { task }) as T);
            for (; index < readers.length; index++) {
                const read = direct[index];
                if (read) values.push(read());
                else {
                    const next = readers[index]();
                    values.push('done' in next ? next.value : (yield { task: next }) as T);
                }
            }
            const result = finish(values, context);
            return 'done' in result ? result.value : (yield { task: result }) as R;
        };
        try {
            const run = new Function('direct', 'readers', 'apply', 'suspend', source)(direct, readers, finish, suspend) as (context: C) => Evaluation<R>;
            return context => currentDiagnostics()?.traceCompiler
                ? observeCompiler(site, backend, 'execute', () => run(context), undefined, true) : run(context);
        } catch { return declineCompiler('dynamic-code-unavailable', site); }
    });
}
