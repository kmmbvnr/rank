import type { NumericBound, NumericNode } from './numeric-function.js';
export type NumericRun = (data: ArrayLike<number>[], scalars: number[], output: Float64Array[]) => boolean;
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const sizeOf = (shape: readonly number[]) => shape.reduce((a, b) => a * b, 1);
const unshape = (node: NumericNode): NumericNode => node.kind === 'reshape' ? unshape(node.source) : node;

/** Structural nodes contribute addressing, not intermediate array allocations.
 * Common concat layouts stream all pieces of all returned arrays together. */
export function emitNumericFunction(roots: NumericNode[], bound: ReadonlyMap<NumericNode, NumericBound>, scalarSlots: ReadonlyMap<NumericNode, number>): string | undefined {
    const sources = roots.map(unshape);
    const first = sources[0], concat = first.kind === 'concat' ? first : undefined;
    const common = concat && sources.every(n => n.kind === 'concat' && n.axis === concat.axis && n.sources.length === concat.sources.length
        && n.sources.every((s, i) => same(bound.get(s)!.shape, bound.get(concat.sources[i])!.shape)));
    if (concat && (!common || concat.sources.some(s => !same(bound.get(s)!.shape, bound.get(concat.sources[0])!.shape)))) return undefined;
    if (!concat && !roots.every(r => same(bound.get(r)!.shape, bound.get(roots[0])!.shape))) return undefined;
    const allowedConcats = new Set(common ? sources : []);
    for (const node of bound.keys()) if (node.kind === 'concat' && !allowedConcats.has(node)) return undefined;
    const frame = bound.get(concat ? concat.sources[0] : roots[0])!, size = frame.size;
    const lines: string[] = [], indices = new Map<string, string>();
    const emitted = new Map<NumericNode, Map<string, string>>();
    let serial = 0;
    const indexVar = (expression: string): string => {
        if (expression === 'i' || expression === '0') return expression;
        const known = indices.get(expression); if (known) return known;
        const name = `p${serial++}`; indices.set(expression, name);
        lines.push(`const ${name} = ${expression};`); return name;
    };
    const mapped = (index: string, block: number, width: number, offset: number) => block === width && offset === 0 ? index
        : indexVar(`Math.floor(${index} / ${block}) * ${width} + ${index} % ${block} + ${offset}`);
    function broadcast(index: string, parent: readonly number[], child: readonly number[]): string {
        if (!child.length || sizeOf(child) === 1) return '0';
        if (same(parent, child)) return index;
        const leading = parent.length - child.length;
        if (child.every((n, i) => n === parent[leading + i])) return indexVar(`${index} % ${sizeOf(child)}`);
        const terms = child.flatMap((n, i) => n === 1 ? [] : [`(Math.floor(${index} / ${sizeOf(parent.slice(leading + i + 1))}) % ${n}) * ${sizeOf(child.slice(i + 1))}`]);
        return indexVar(terms.join(' + ') || '0');
    }
    function emit(node: NumericNode, index: string): string {
        const info = bound.get(node)!;
        if (!info.shape.length) return `scalars[${scalarSlots.get(node)}]`;
        const old = emitted.get(node)?.get(index); if (old) return old;
        if (node.kind === 'reshape') return emit(node.source, index);
        if (node.kind === 'slice') {
            const source = bound.get(node.source)!;
            const inner = sizeOf(source.shape.slice(node.axis + 1));
            return emit(node.source, mapped(index, inner, source.shape[node.axis] * inner, node.position * inner));
        }
        if (node.kind === 'gather') return emit(node.source, emit(node.indices, index));
        let expression: string;
        if (node.kind === 'input') expression = `data[${info.data}][${index}]`;
        else if (node.kind === 'range') expression = `scalars[${scalarSlots.get(node.start)}] + (${index})`;
        else if (node.kind === 'unary') expression = `${node.op}(${emit(node.child, index)})`;
        else if (node.kind === 'binary') {
            const a = emit(node.left, broadcast(index, info.shape, bound.get(node.left)!.shape));
            const b = emit(node.right, broadcast(index, info.shape, bound.get(node.right)!.shape));
            expression = node.op === '//' ? `Math.floor((${a}) / (${b}))` : `(${a}) ${node.op} (${b})`;
        } else throw new Error('unsupported numeric function node');
        const name = `v${serial++}`;
        let entries = emitted.get(node); if (!entries) emitted.set(node, entries = new Map()); entries.set(index, name);
        lines.push(`let ${name} = ${expression}; if (!${info.integer ? 'Number.isSafeInteger' : 'Number.isFinite'}(${name})) return false;`);
        if (info.integer) lines.push(`if (${name} === 0) ${name} = 0;`);
        return name;
    }
    const assignments: string[] = [];
    if (concat && common) {
        const shape = bound.get(concat)!.shape, axis = concat.axis;
        const inner = sizeOf(shape.slice(axis + 1)), block = frame.shape[axis] * inner, width = shape[axis] * inner;
        for (let part = 0; part < concat.sources.length; part++) {
            const target = mapped('i', block, width, part * block);
            for (const [out, source] of sources.entries()) {
                if (source.kind !== 'concat') return undefined;
                assignments.push(`output[${out}][${target}] = ${emit(source.sources[part], 'i')};`);
            }
        }
    } else for (const [out, root] of roots.entries()) assignments.push(`output[${out}][i] = ${emit(root, 'i')};`);
    return `"use strict"; /* numeric-array-function */ return function(data, scalars, output) { for (let i = 0; i < ${size}; i++) { ${lines.join('\n')} ${assignments.join('\n')} } return true; };`;
}
