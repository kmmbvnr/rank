import { loopOperatorSignature, flattenApplication, isApplicationExpression, isBinaryExpression, isNameExpression,
    isParenthesizedExpression, type ArrayAssignmentStatement, type BinaryExpression, type Expression } from '@arrrank/language';
import { isRankArray } from '../value.js';
import type { LoopCompilationState } from './integer-loop-state.js';
import type { LoopExpressions } from './integer-loop-expressions.js';

function unparenthesized(value: Expression): Expression {
    while (isParenthesizedExpression(value)) value = value.value;
    return value;
}

/** A scalar prefix and a trailing arithmetic range select one row. Invalid
 * selections replay the original statement, retaining its error and timing.
 * This lowering only touches private cells, including the complete RHS snapshot. */
export function emitNumberSlice(state: LoopCompilationState, expressions: LoopExpressions,
    assignment: ArrayAssignmentStatement, body: string[], location: number): true | undefined {
    if (!state.numberMode || state.wideScalars.size || !['=', '+=', '-=', '*='].includes(assignment.operator)) return undefined;
    if (assignment.operator !== '=') {
        const signature = loopOperatorSignature(assignment.operator.slice(0, -1), ['integer', 'integer'], state.host.nativeCalls);
        if (!signature?.compound || signature.result !== 'integer') return undefined;
    }
    const selectors = assignment.indices.map(index => index.value);
    const last = selectors.at(-1);
    if (!last) return undefined;
    const range = unparenthesized(last);
    if (!isBinaryExpression(range) || !['to', 'till'].includes(range.operator)) return undefined;
    const rhs = unparenthesized(assignment.value);
    if (!isApplicationExpression(rhs)) return undefined;
    const parts = flattenApplication(rhs), source = parts.shift();
    if (!source || !isNameExpression(source) || source.name.includes('.') || !parts.length) return undefined;
    const inputRange = unparenthesized(parts.at(-1)!);
    if (!isBinaryExpression(inputRange) || !['to', 'till'].includes(inputRange.operator)) return undefined;
    const { arrays, destinations, assigned, arrayInputs } = state;
    const previous = destinations.get(assignment.name), known = arrays.get(assignment.name);
    const rank = selectors.length;
    if (previous && (previous.rank !== rank || previous.type !== 'integer')
        || known && (known.rank !== rank || known.type !== 'integer')) return undefined;
    const existing = arrays.get(source.name) ?? destinations.get(source.name);
    const value = existing ? undefined : state.host.read(source.name);
    if (existing ? existing.rank !== parts.length || existing.type !== 'integer'
        : !value || !isRankArray(value) || value.shape.length !== parts.length
            || expressions.realInput(source.name) !== undefined) return undefined;
    const target = previous ?? { slot: expressions.slot(assignment.name), rank, compound: assignment.operator !== '=', type: 'integer' as const };
    const input = { slot: existing?.slot ?? expressions.slot(source.name), rank: parts.length, type: 'integer' as const };
    destinations.set(assignment.name, target);
    arrays.set(source.name, input);
    state.sliceReadSources.add(source.name);
    state.currentScope()?.assigned.add(assignment.name);
    if (!assigned.has(assignment.name)) arrayInputs.add(assignment.name);
    if (!assigned.has(source.name)) arrayInputs.add(source.name);
    const lines: string[] = [];
    function selection(slot: number, coordinates: (Expression | undefined)[], r: BinaryExpression): { offset: string; count: string; stride: string } | undefined {
        const prefix: string[] = [];
        for (const coordinate of coordinates.slice(0, -1)) {
            if (!coordinate) return undefined;
            const term = expressions.emit(coordinate, lines, 'integer');
            if (term?.type !== 'integer') return undefined;
            const name = `coordinate${state.serial++}`;
            lines.push(`const ${name} = ${term.code};`);
            prefix.push(name);
        }
        const start = expressions.emit(r.left, lines, 'integer');
        if (start?.type !== 'integer') return undefined;
        const first = `first${state.serial++}`;
        lines.push(`const ${first} = ${start.code};`);
        const end = expressions.emit(r.right, lines, 'integer');
        if (end?.type !== 'integer') return undefined;
        const limit = `limit${state.serial++}`;
        lines.push(`const ${limit} = ${end.code};`);
        const step = r.step ? expressions.emit(r.step, lines, 'integer') : { code: '1', type: 'integer' };
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
            const ${count} = span${n} < ${r.operator === 'to' ? '0' : '1'} ? 0
                : Math.floor((span${n}${r.operator === 'to' ? '' : ' - 1'}) / Math.abs(${stride})) + 1;
            if (${count} > 0) {
                const last${n} = safe(${first} + safe((${count} - 1) * ${stride}));
                if (${first} < 0 || ${first} >= ${size} || last${n} < 0 || last${n} >= ${size}) throw overflow;
            }
            const ${offset} = ${prefix.length ? `${base} * ${size} + ` : ''}${first};`);
        return { offset, count, stride };
    }
    const destination = selection(target.slot, selectors, range);
    const operand = selection(input.slot, parts, inputRange);
    if (!destination || !operand) return undefined;
    const n = state.serial++, snapshot = `snapshot${n}`, index = `element${n}`, key = `cell${n}`;
    lines.push(`if (${destination.count} !== ${operand.count}) throw overflow;
        const ${snapshot} = sliceArray(cells${input.slot}, ${operand.offset}, ${operand.count}, ${operand.stride});
        for (let ${index} = 0, ${key} = ${destination.offset}; ${index} < ${destination.count}; ${index}++, ${key} += ${destination.stride}) {
            ${state.checkpoint}
            const next${n} = ${assignment.operator === '=' ? `${snapshot}.cells[${index}]`
                : `safe(cells${target.slot}[${key}] ${assignment.operator[0]} ${snapshot}.cells[${index}])`};
            if (cells${target.slot} instanceof Int32Array && next${n} !== (next${n} | 0)) {
                cells${target.slot} = cells[${target.slot}] = new Float64Array(cells${target.slot});
                ${state.arrayDefinitions.has(assignment.name) ? `r${target.slot}.cells = cells${target.slot};` : ''}
            }
            cells${target.slot}[${key}] = next${n};
            ${state.arrayDefinitions.has(assignment.name) ? '' : `changed${target.slot}[${key}] = 1;`}
        }
        iterationResult = sliceResult(r${input.slot}, ${operand.offset}, ${operand.count}, ${operand.stride}); iterationType = 'array';`);
    body.push(`location = ${location};`, ...lines);
    return true;
}
