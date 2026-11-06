import { loopOperatorSignature, flattenApplication, isApplicationExpression, isNameExpression,
    isParenthesizedExpression, isBinaryExpression, type ArrayAssignmentStatement, type Expression } from '@arrrank/language';
import { isRankArray } from '../value.js';
import type { LoopCompilationState } from './integer-loop-state.js';
import type { LoopExpressions } from './integer-loop-expressions.js';

function unparenthesized(value: Expression): Expression {
    while (isParenthesizedExpression(value)) value = value.value;
    return value;
}

/** A scalar prefix and a trailing arithmetic range select one row. Invalid
 * selections replay the original statement, retaining its error and timing.
 * This lowering only touches private cells. Stores use one scalar value or
 * a complete RHS snapshot when source and destination may overlap. */
export function emitNumberSlice(state: LoopCompilationState, expressions: LoopExpressions,
    assignment: ArrayAssignmentStatement, body: string[], location: number): true | undefined {
    if (!state.numberMode || !['=', '+=', '-=', '*=', '//='].includes(assignment.operator)) return undefined;
    if (assignment.operator !== '=') {
        const signature = loopOperatorSignature(assignment.operator.slice(0, -1), ['integer', 'integer'], state.host.nativeCalls);
        if (!signature?.compound || signature.result !== 'integer') return undefined;
    }
    const selectors = assignment.indices.map(index => index.value);
    const last = selectors.at(-1);
    if (!last) return undefined;
    const range = unparenthesized(last);
    if (!expressions.isRange(range)) return undefined;
    // A function prefix excludes its final return. Do not use that caller's
    // statement as a discard proof either; its last compiled statement is a
    // conservative boundary for the slice results we can eliminate.
    const discarded = state.resultDiscarded(assignment);
    const rhs = unparenthesized(assignment.value);
    // A transformed RHS is a fresh value. Elide it only when discarded; an
    // escaping result must never become a live view of its source instead.
    const candidate = discarded && isBinaryExpression(rhs) && !rhs.step
        && ['+', '-', '*', '//', 'mod'].includes(rhs.operator) ? rhs : undefined;
    const selected = candidate ? unparenthesized(candidate.left) : rhs;
    const parts = isApplicationExpression(selected) ? flattenApplication(selected) : [];
    const source = parts.shift();
    const inputRange = parts.length ? unparenthesized(parts.at(-1)!) : undefined;
    const slice = source && isNameExpression(source) && !source.name.includes('.')
        && inputRange && expressions.isRange(inputRange)
        ? { name: source.name, parts, range: inputRange } : undefined;
    const transform = slice ? candidate : undefined;
    const { arrays, destinations, assigned, arrayInputs } = state;
    const previous = destinations.get(assignment.name), known = arrays.get(assignment.name);
    const rank = selectors.length;
    if (previous && (previous.rank !== rank || previous.type !== 'integer')
        || known && (known.rank !== rank || known.type !== 'integer')) return undefined;
    const target = previous ?? { slot: expressions.slot(assignment.name), rank, compound: assignment.operator !== '=', type: 'integer' as const };
    destinations.set(assignment.name, target);
    state.currentScope()?.assigned.add(assignment.name);
    if (!assigned.has(assignment.name)) arrayInputs.add(assignment.name);
    let input: { slot: number; rank: number; type: 'integer' } | undefined;
    if (slice) {
        const existing = arrays.get(slice.name) ?? destinations.get(slice.name);
        const value = existing ? undefined : state.host.read(slice.name);
        if (existing ? existing.rank !== slice.parts.length || existing.type !== 'integer'
            : !value || !isRankArray(value) || value.shape.length !== slice.parts.length
                || expressions.realInput(slice.name) !== undefined) return undefined;
        input = { slot: existing?.slot ?? expressions.slot(slice.name), rank: slice.parts.length, type: 'integer' };
        arrays.set(slice.name, input);
        state.sliceReadSources.add(slice.name);
        if (!discarded) state.sliceResultSources.add(slice.name);
        if (!assigned.has(slice.name)) arrayInputs.add(slice.name);
    }
    const lines: string[] = [];
    function selection(slot: number, coordinates: (Expression | undefined)[], r: Expression): { offset: string; count: string; stride: string } | undefined {
        const prefix: string[] = [];
        for (const coordinate of coordinates.slice(0, -1)) {
            if (!coordinate) return undefined;
            const term = expressions.emit(coordinate, lines, 'integer');
            if (term?.type !== 'integer') return undefined;
            const name = `coordinate${state.serial++}`;
            lines.push(`const ${name} = ${term.code};`);
            prefix.push(name);
        }
        const bounds = expressions.rangeOperands(r, lines);
        if (!bounds) return undefined;
        const start = bounds.start;
        if (start?.type !== 'integer') return undefined;
        const first = `first${state.serial++}`;
        lines.push(`const ${first} = ${start.code};`);
        const end = bounds.end;
        if (end?.type !== 'integer') return undefined;
        const limit = `limit${state.serial++}`;
        lines.push(`const ${limit} = ${end.code};`);
        const step = bounds.step;
        if (step?.type !== 'integer') return undefined;
        const n = state.serial++, stride = `stride${n}`, count = `count${n}`, offset = `offset${n}`;
        const size = coordinates.length === 1 ? `cells${slot}.length` : `size${slot}_${coordinates.length - 1}`;
        lines.push(`const ${stride} = ${step.code}; if (${stride} === 0) throw overflow;`);
        let base = '0';
        prefix.forEach((coordinate, axis) => {
            lines.push(`if (${coordinate} < 0 || ${coordinate} >= size${slot}_${axis}) throw overflow;`);
            base = `(${base} * size${slot}_${axis} + ${coordinate})`;
        });
        lines.push(`const span${n} = safe(${stride} > 0 ? ${limit} - ${first} : ${first} - ${limit});
            const ${count} = span${n} < ${bounds.inclusive ? '0' : '1'} ? 0
                : Math.floor((span${n}${bounds.inclusive ? '' : ' - 1'}) / Math.abs(${stride})) + 1;
            if (${count} > 0) {
                const last${n} = safe(${first} + safe((${count} - 1) * ${stride}));
                if (${first} < 0 || ${first} >= ${size} || last${n} < 0 || last${n} >= ${size}) throw overflow;
            }
            const ${offset} = ${prefix.length ? `${base} * ${size} + ` : ''}${first};`);
        return { offset, count, stride };
    }
    const destination = selection(target.slot, selectors, range);
    if (!destination) return undefined;
    const operand = slice && input ? selection(input.slot, slice.parts, slice.range) : undefined;
    if (slice && !operand) return undefined;
    const n = state.serial++, snapshot = `snapshot${n}`, index = `element${n}`, key = `cell${n}`;
    if (operand && input) {
        lines.push(`if (${destination.count} !== ${operand.count}) throw overflow;
            const source${n} = cells${input.slot};
            const direct${n} = disjointSlices(cells${target.slot}, ${destination.offset}, ${destination.stride}, source${n}, ${operand.offset}, ${operand.stride}, ${operand.count}${transform ? ", true" : ""});
            const ${snapshot} = direct${n} ? undefined : sliceArray(source${n}, ${operand.offset}, ${operand.count}, ${operand.stride});
            const operand${n} = direct${n} ? source${n} : ${snapshot}.cells;
            const start${n} = direct${n} ? ${operand.offset} : 0;
            const step${n} = direct${n} ? ${operand.stride} : 1;`);
    } else {
        // Demand a scalar once, including for an empty selection. An element
        // of the destination is read before any of the selected cells change.
        const scalar = expressions.emit(rhs, lines, 'integer');
        if (scalar?.type !== 'integer') return undefined;
        lines.push(`const ${snapshot} = ${scalar.code};`);
    }
    let replacement = operand ? `operand${n}[cursor${n}]` : snapshot;
    const operations: string[] = [];
    if (transform) {
        const scalar = expressions.emit(transform.right, lines, 'integer');
        if (scalar?.type !== 'integer') return undefined;
        const right = `scalar${n}`;
        lines.push(`const ${right} = ${scalar.code};`);
        if (transform.operator === '//' || transform.operator === 'mod') operations.push(`if (${right} === 0) throw overflow;`);
        const value = expressions.arithmetic(transform.operator, { code: replacement, type: 'integer' },
            { code: right, type: 'integer' }, 'integer', operations);
        if (!value) return undefined;
        replacement = value;
    }
    if (assignment.operator === '//=') operations.push(`if (${replacement} === 0) throw overflow;`);
    // Keep the existing simple updates' code and temporary budget unchanged.
    const next = assignment.operator === '=' ? replacement
        : assignment.operator === '//=' ? expressions.arithmetic('//', { code: `cells${target.slot}[${key}]`, type: 'integer' },
            { code: replacement, type: 'integer' }, 'integer', operations)
        : `safe(cells${target.slot}[${key}] ${assignment.operator[0]} ${replacement})`;
    if (!next) return undefined;
    lines.push(`
        for (let ${index} = 0, ${key} = ${destination.offset}${operand ? `, cursor${n} = start${n}` : ''}; ${index} < ${destination.count}; ${index}++, ${key} += ${destination.stride}${operand ? `, cursor${n} += step${n}` : ''}) {
            ${state.checkpoint}
            ${operations.join('\n')}
            const next${n} = ${next};
            if (cells${target.slot} instanceof Int32Array && next${n} !== (next${n} | 0)) {
                cells${target.slot} = cells[${target.slot}] = new Float64Array(cells${target.slot});
                ${state.arrayDefinitions.has(assignment.name) ? `r${target.slot}.cells = cells${target.slot};` : ''}
            }
            cells${target.slot}[${key}] = next${n};
            ${state.arrayDefinitions.has(assignment.name) ? '' : `changed${target.slot}[${key}] = 1;`}
        }
        iterationResult = ${discarded && operand ? 'undefined' : operand && input ? `sliceResult(r${input.slot}, ${operand.offset}, ${operand.count}, ${operand.stride})` : snapshot}; iterationType = '${operand && !discarded ? 'array' : 'integer'}';`);
    body.push(`location = ${location};`, ...lines);
    return true;
}
