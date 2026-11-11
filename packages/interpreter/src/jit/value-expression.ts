import { isApplicationExpression, isNameExpression, isLabelLiteral, flattenApplication, isRecordExpression, isRecordUpdateExpression, isTupleExpression, type Expression } from '@arrrank/language';
import { observeCompiler, observedRun, declineCompiler } from '../compiler-observation.js';
import { createRecord, copyRecordForUpdate, checkNewRecordField, initializeRecordField } from '../record-construction.js';
import { recordContract } from '../record-contract.js';
import { assignRecordField } from '../record-write.js';
import { RankError } from '../errors.js';
import { inspectionEnabled } from '../interrupt.js';
import type { Operators } from '../operators.js';
import { isNativeFunction, MISSING, tuple, type RankValue } from '../value.js';

interface Host {
    direct(expression: Expression): (() => RankValue) | undefined;
    operators: Operators;
    select(values: RankValue[]): RankValue;
}

/** Generated structural operations use the same runtime contracts as interpretation.
 * Code depends only on syntax, never field values, layouts or a container's element domain. */
export function compileValueExpression(expression: Expression, host: Host): (() => RankValue) | undefined {
    const parts = isApplicationExpression(expression) ? flattenApplication(expression) : [];
    const fields = parts.length > 1 && isNameExpression(parts[0]) && /^[A-Z]/.test(parts[0].name)
        && parts.slice(1).every(isLabelLiteral);
    if (!fields && !isRecordExpression(expression) && !isRecordUpdateExpression(expression) && !isTupleExpression(expression)) return undefined;
    return observeCompiler(expression, 'value-expression', 'prepare', () => {
        if (inspectionEnabled()) return declineCompiler('inspection-enabled', expression);
        const count = fields ? parts.length : isTupleExpression(expression) ? expression.items.length
            : isRecordExpression(expression) || isRecordUpdateExpression(expression) ? expression.fields.length : 0;
        if (count > 64) return declineCompiler('field-budget', expression);
        const reads: (() => RankValue)[] = [];
        const read = (node: Expression): string | undefined => {
            const run = host.direct(node);
            return run && `reads[${reads.push(run) - 1}]()`;
        };
        let source = '"use strict"; return function() {\n';
        if (fields) {
            const input = read(parts[0]);
            if (!input) return declineCompiler('resumable-operand-required', parts[0]);
            const labels = parts.slice(1).map(part => isLabelLiteral(part) && part.name === 'NA' ? 'missing'
                : `{kind:'label', name:${JSON.stringify(isLabelLiteral(part) ? part.name : '')}}`);
            source += `const input = ${input};
                if (isFunction(input)) throw new RankError('operation must follow its data: ' + input.name);
                return select([input, ${labels.join(',')}]);`;
        } else if (isTupleExpression(expression)) {
            const items: string[] = [];
            for (const item of expression.items) {
                const value = read(item.value);
                if (!value) return declineCompiler('resumable-operand-required', item.value);
                items.push(item.sign ? `unary(${JSON.stringify(item.sign)}, ${value})` : value);
            }
            source += `return tuple([${items.join(',')}]);`;
        } else if (isRecordExpression(expression) || isRecordUpdateExpression(expression)) {
            const update = isRecordUpdateExpression(expression);
            const input = update ? read(expression.source) : undefined;
            if (update && !input) return declineCompiler('resumable-operand-required', expression.source);
            source += `const record = ${update ? `copy(${input})` : 'create()'};\n`;
            const changed = new Set<string>();
            for (const field of expression.fields) {
                const name = JSON.stringify(field.name);
                // Reject a repeated field at execution time, before its RHS, just
                // as the reference constructor does. Later operands stay unprepared.
                if (changed.has(field.name)) {
                    source += `throw new RankError(${JSON.stringify(`duplicate record field: .${field.name}`)});\n`;
                    break;
                }
                changed.add(field.name);
                const value = read(field.value);
                if (!value) return declineCompiler('resumable-operand-required', field.value);
                source += update
                    ? `write(record, ${name}, ${JSON.stringify('operator' in field ? field.operator : '=')}, ${value});\n`
                    : `check(record, ${name}); init(record, ${name}, ${value});\n`;
            }
            source += `${update ? '' : 'contract(record);'} return record;`;
        }
        source += '\n};';
        try {
            const run = new Function('reads', 'create', 'copy', 'check', 'init', 'contract', 'write', 'tuple', 'unary', 'RankError', 'select', 'isFunction', 'missing', source)(
                reads, createRecord, copyRecordForUpdate, checkNewRecordField, initializeRecordField, recordContract,
                (record: Parameters<typeof assignRecordField>[0], name: string, op: string, value: RankValue) =>
                    assignRecordField(record, name, op, value, host.operators),
                tuple, (op: string, value: RankValue) => host.operators.evaluateUnary(op, value), RankError,
                observedRun(expression, 'native-value-selection', host.select, undefined, false), isNativeFunction, MISSING,
            ) as () => RankValue;
            return observedRun(expression, 'value-expression', run, undefined, false);
        } catch { return declineCompiler('dynamic-code-unavailable', expression); }
    });
}
