import { flattenApplication, isApplicationExpression, isBinaryExpression, isNameExpression, isParenthesizedExpression,
    loopOperatorSignature, type ArrayAssignmentStatement, type Expression } from '@arrrank/language';
import type { LoopCompilationState } from './integer-loop-state.js';
import type { LoopExpressions } from './integer-loop-expressions.js';

/** Complete a numeric vector RHS before a one-dimensional range write.
 * Private failures replay the ordinary selector, RHS and publication order. */
export function emitNumberArraySlice(state: LoopCompilationState, expressions: LoopExpressions,
    assignment: ArrayAssignmentStatement, body: string[], location: number): true | undefined {
    if (!state.numberMode || assignment.accumulate || assignment.indices.length !== 1
        || !['=', '+=', '-=', '*='].includes(assignment.operator)) return undefined;
    const address = assignment.indices[0];
    if (!address.value || address.all || address.sign || !expressions.isRange(address.value)) return undefined;
    const { arrays, destinations, arrayInputs, assigned } = state;
    const old = destinations.get(assignment.name), known = arrays.get(assignment.name);
    const type = old?.type ?? known?.type ?? expressions.arrayType({ $type: 'NameExpression', name: assignment.name } as Expression)?.element;
    if (old && old.rank !== 1 || known && known.rank !== 1 || type !== 'real' && type !== 'integer') return undefined;
    // Keep existing scalar integer stores and slice-to-slice transfers intact.
    if (type === 'integer' && !expressions.arrayType(assignment.value)) return undefined;
    if (type === 'integer') {
        const unwrap = (value: Expression): Expression => isParenthesizedExpression(value) ? unwrap(value.value) : value;
        const rhs = unwrap(assignment.value);
        const selected = state.resultDiscarded(assignment) && isBinaryExpression(rhs) && !rhs.step
            && ['+', '-', '*', '//', 'mod'].includes(rhs.operator) ? unwrap(rhs.left) : rhs;
        const parts = isApplicationExpression(selected) ? flattenApplication(selected) : [];
        if (parts.length >= 2 && isNameExpression(parts[0]) && expressions.isRange(parts.at(-1)!)) return undefined;
    }
    const compound = assignment.operator !== '=';
    if (compound) {
        const signature = loopOperatorSignature(assignment.operator.slice(0, -1), [type, type], state.host.nativeCalls);
        if (!signature?.compound || signature.result !== type) return undefined;
    }
    const target = old ?? { slot: expressions.slot(assignment.name), rank: 1, compound, type };
    destinations.set(assignment.name, target);
    state.currentScope()?.assigned.add(assignment.name);
    if (!assigned.has(assignment.name)) arrayInputs.add(assignment.name);
    state.numberVectors = true;
    const lines = ['if (!streamScatterEnabled()) throw overflow;'];
    const bounds = expressions.rangeOperands(address.value, lines);
    if (!bounds) return undefined;
    const n = state.serial++, cells = `cells${target.slot}`, first = `first${n}`, step = `step${n}`, count = `count${n}`;
    lines.push(`const ${first} = ${bounds.start.code}, end${n} = ${bounds.end.code}, ${step} = ${bounds.step.code};
        if (${step} === 0) throw overflow;
        const span${n} = safe(${step} > 0 ? end${n} - ${first} : ${first} - end${n});
        const ${count} = span${n} < ${bounds.inclusive ? '0' : '1'} ? 0
            : safe(Math.floor((span${n}${bounds.inclusive ? '' : ' - 1'}) / Math.abs(${step})) + 1);
        if (${count}) {
            const last${n} = safe(${first} + safe((${count} - 1) * ${step}));
            if (${first} < 0 || ${first} >= ${cells}.length || last${n} < 0 || last${n} >= ${cells}.length) throw overflow;
        }`);
    const calls = state.calls.length, callouts = state.callouts.length;
    const rhs = expressions.emitValue(assignment.value, lines, type);
    if (!rhs || (typeof rhs.type === 'string' ? rhs.type : rhs.type.element) !== type
        || state.calls.length !== calls || state.callouts.length !== callouts) return undefined;
    const scalar = typeof rhs.type === 'string', operand = `operand${n}`;
    if (!scalar) {
        if (rhs.type.rank !== 1 || !state.resultDiscarded(assignment) && (compound || !rhs.fresh)) return undefined;
        const source = rhs.cells ?? `${rhs.code}.cells`;
        lines.push(`if (${rhs.code}.shape.length !== 1 || ${rhs.code}.shape[0] !== ${count}) throw overflow;
            const ${operand} = ${source} === ${cells} || ${source}.buffer && ${source}.buffer === ${cells}.buffer
                ? sliceArray(${source}, 0, ${source}.length, 1).cells : ${source};`);
    } else lines.push(`const ${operand} = ${rhs.code};`);
    const index = `element${n}`, key = `key${n}`, operations: string[] = [];
    let value = scalar ? operand : type === 'real' ? `Number(${operand}[${index}])` : `safe(Number(${operand}[${index}]))`;
    if (compound) {
        const combined = expressions.arithmetic(assignment.operator.slice(0, -1),
            { code: `${cells}[${key}]`, type }, { code: value, type }, type, operations);
        if (!combined) return undefined;
        value = combined;
    }
    body.push(`location = ${location};`, ...lines, expressions.numberVectorLoop(count, index, [
        `const ${key} = ${first} + ${index} * ${step};`, ...operations, `const value${n} = ${value};`,
        ...(type === 'integer' ? [`if (${cells} instanceof Int32Array && value${n} !== (value${n} | 0)) {
            ${cells} = cells[${target.slot}] = new Float64Array(${cells});
            ${state.arrayDefinitions.has(assignment.name) ? `r${target.slot}.cells = ${cells};` : ''}
        }`] : []),
        `${cells}[${key}] = value${n}; ${state.arrayDefinitions.has(assignment.name) ? '' : `changed${target.slot}[${key}] = 1;`}`,
    ]), `iterationResult = ${scalar ? operand : rhs.code}; iterationType = '${scalar ? type : 'array'}';`);
    return true;
}
