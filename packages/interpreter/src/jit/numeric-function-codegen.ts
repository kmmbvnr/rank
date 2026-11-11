import type { NumericBound, NumericNode } from './numeric-function.js';
export type NumericRun = (data: ArrayLike<number>[], scalars: number[], output: (Float64Array | Int32Array)[], sizes?: readonly number[]) => boolean;
const operators: Record<string, string> = { band: '&', bor: '|', bxor: '^', equal: '===', notequal: '!==', less: '<', greater: '>', atmost: '<=', atleast: '>=' };
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const sizeOf = (shape: readonly number[]) => shape.reduce((a, b) => a * b, 1);
const unshape = (node: NumericNode): NumericNode => node.kind === 'reshape' ? unshape(node.source) : node;

/** Structural nodes contribute addressing, not intermediate array allocations.
 * Common concat layouts stream all pieces of all returned arrays together. */
export function emitNumericFunction(roots: NumericNode[], bound: ReadonlyMap<NumericNode, NumericBound>, scalarSlots: ReadonlyMap<NumericNode, number>): string | undefined {
    if (roots.every(root => !bound.get(root)!.shape.length)) return emitReductions(roots, bound, scalarSlots);
    if ([...bound.keys()].some(node => !scalarSlots.has(node) && (node.kind === 'choose' || node.kind === 'sum'
        || node.kind === 'binary' && !['+', '-', '*', '/', '//', 'band', 'bor', 'bxor', 'min', 'max', 'equal', 'notequal', 'less', 'greater', 'atmost', 'atleast'].includes(node.op)))) return undefined;
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
        if (!child.length) return '0';
        if (same(parent, child)) return index;
        if (sizeOf(child) === 1) return '0';
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
        else if (node.kind === 'sqrt') {
            const value = emit(node.source, index);
            lines.push(`if (${value} < 0) return false;`);
            expression = `isqrt(${value})`;
        }
        else if (node.kind === 'integer') expression = `Number(${emit(node.source, index)})`;
        else if (node.kind === 'math') expression = `Math.${node.op}(${emit(node.source, index)})`;
        else if (node.kind === 'binary') {
            const a = emit(node.left, broadcast(index, info.shape, bound.get(node.left)!.shape));
            const b = emit(node.right, broadcast(index, info.shape, bound.get(node.right)!.shape));
            expression = ['min', 'max'].includes(node.op) ? `((${b}) ${node.op === 'min' ? '<' : '>'} (${a}) ? (${b}) : (${a}))` : node.op === '//' ? `Math.floor((${a}) / (${b}))` : `(${a}) ${operators[node.op] ?? node.op} (${b})`;
        } else throw new Error('unsupported numeric function node');
        const name = `v${serial++}`;
        let entries = emitted.get(node); if (!entries) emitted.set(node, entries = new Map()); entries.set(index, name);
        lines.push(`let ${name} = ${expression}; ${info.boolean ? '' : `if (!${info.integer ? 'Number.isSafeInteger' : 'Number.isFinite'}(${name})) return false;`}`);
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
    // Equal-shaped vector outputs already own the complete frame. Keeping
    // its length dynamic lets one generated program serve different extents.
    // Concat pieces still iterate only their individual source frame.
    const limit = concat && common ? String(size) : 'output[0].length';
    return `"use strict"; /* numeric-array-function */ return function(data, scalars, output) { for (let i = 0; i < ${limit}; i++) { ${lines.join('\n')} ${assignments.join('\n')} } return true; };`;
}

/** Independent exact integer reductions share one traversal per input shape.
 * Input bounds prove integer cell arithmetic; prefix sums and final scalar
 * arithmetic retain guards. Compilation observers revalidate inputs first. */
function emitReductions(roots: NumericNode[], bound: ReadonlyMap<NumericNode, NumericBound>, scalarSlots: ReadonlyMap<NumericNode, number>): string | undefined {
    const all = [...bound.keys()].filter((node): node is NumericNode & { kind: 'sum' } => node.kind === 'sum');
    if (!all.length) return undefined;
    const reductions = all.filter(node => !scalarSlots.has(node));
    const sums = new Map<NumericNode, string>(reductions.map((node, i) => [node, `sum${i}`]));
    const groups = new Map<string, typeof reductions>();
    for (const reduction of reductions) {
        const key = bound.get(reduction.source)!.shape.join(',');
        let group = groups.get(key); if (!group) groups.set(key, group = []);
        group.push(reduction);
    }
    let serial = 0, failed = false;
    const loops: string[] = [];
    function emitter(lines: string[], inside: boolean) {
        const cache = new Map<NumericNode, Map<string, string>>();
        const index = (at: string, parent: readonly number[], child: readonly number[]) => {
            if (!child.length || sizeOf(child) === 1) return '0';
            if (same(parent, child)) return at;
            const leading = parent.length - child.length;
            return child.flatMap((n, i) => n === 1 ? [] : [`(Math.floor((${at}) / ${sizeOf(parent.slice(leading + i + 1))}) % ${n}) * ${sizeOf(child.slice(i + 1))}`]).join(' + ') || '0';
        };
        function emit(node: NumericNode, at: string): string {
            const info = bound.get(node)!;
            const scalar = scalarSlots.get(node); if (scalar !== undefined) return `scalars[${scalar}]`;
            if (node.kind === 'sum') {
                if (inside) { failed = true; return '0'; }
                return sums.get(node)!;
            }
            const previous = cache.get(node)?.get(at); if (previous) return previous;
            let expression: string;
            if (node.kind === 'input') expression = `data[${info.data}][${at}]`;
            else if (node.kind === 'range') expression = `${emit(node.start, '0')} + (${at})`;
            else if (node.kind === 'reshape') return emit(node.source, at);
            else if (node.kind === 'gather') return emit(node.source, emit(node.indices, at));
            else if (node.kind === 'unary') expression = `${node.op}(${emit(node.child, at)})`;
            else if (node.kind === 'sqrt') {
                const value = emit(node.source, at);
                lines.push(`if (${value} < 0) return false;`);
                expression = `isqrt(${value})`;
            }
            else if (node.kind === 'choose') {
                const condition = emit(node.condition, index(at, info.shape, bound.get(node.condition)!.shape));
                const yes = emit(node.yes, index(at, info.shape, bound.get(node.yes)!.shape));
                const no = emit(node.no, index(at, info.shape, bound.get(node.no)!.shape));
                expression = `${condition} ? ${yes} : ${no}`;
            } else if (node.kind === 'binary') {
                const a = emit(node.left, index(at, info.shape, bound.get(node.left)!.shape));
                const b = emit(node.right, index(at, info.shape, bound.get(node.right)!.shape));
                expression = ['min', 'max'].includes(node.op) ? `((${b}) ${node.op === 'min' ? '<' : '>'} (${a}) ? (${b}) : (${a}))` : node.op === '//' ? `Math.floor((${a}) / (${b}))`
                    : node.op === 'mod' ? `(${a}) % (${b})` : `(${a}) ${operators[node.op] ?? node.op} (${b})`;
                if (node.op === 'mod') {
                    const name = `v${serial++}`;
                    lines.push(`let ${name} = ${expression}; if (${name} !== 0 && (${name} < 0) !== (${b} < 0)) ${name} += ${b};`);
                    expression = name;
                }
            } else { failed = true; return '0'; }
            const name = `v${serial++}`;
            let entries = cache.get(node); if (!entries) cache.set(node, entries = new Map()); entries.set(at, name);
            lines.push(`let ${name} = ${expression};`);
            if (!info.boolean && !inside) lines.push(`if (!Number.isSafeInteger(${name})) return false; if (${name} === 0) ${name} = 0;`);
            return name;
        }
        return emit;
    }
    let frame = 0;
    for (const group of groups.values()) {
        const lines: string[] = [], emit = emitter(lines, true);
        const additions = group.map(node => {
            const value = emit(node.source, 'i'), sum = sums.get(node)!;
            return `${sum} += ${value}; if (!Number.isSafeInteger(${sum})) return false;`;
        });
        loops.push(`for (let i = 0; i < ${`sizes[${frame++}]`}; i++) { ${lines.join('\n')} ${additions.join('\n')} }`);
    }
    const final: string[] = [], emit = emitter(final, false);
    const outputs = roots.map((root, i) => `output[${i}][0] = ${emit(root, '0')};`);
    if (failed) return undefined;
    return `"use strict"; /* numeric-array-function integer reductions */ return function(data, scalars, output, sizes) {
        ${[...sums.values()].map(name => `let ${name} = 0;`).join('\n')}
        ${loops.join('\n')}
        ${final.join('\n')}
        ${outputs.join('\n')}
        return true;
    };`;
}
