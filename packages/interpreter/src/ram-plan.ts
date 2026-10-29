import { ramModel, type RamNode } from './ram-model.js';
import type { RamGraph, RamGpu } from './mlrank.js';
import type { FileTensorInput } from './file-tensor.js';
import type { RamStateDescriptor } from './ram-state.js';
import { checkInterrupt } from './interrupt.js';
import { RankError } from './errors.js';

export interface RamPart {
    readonly graph: RamGraph;
    /** Original graph node IDs, in this part's input order. */
    readonly inputs: readonly number[];
    readonly output: number;
}
const size = (shape: readonly number[]) => shape.reduce((a, b) => a * b, 1);
export function ramDependencies(node: RamNode): readonly number[] {
    if (node.kind === 'concat') return node.operands;
    if (node.kind === 'transpose') return [node.input, node.permutation];
    if (node.kind === 'slice') return [node.input, node.begin, node.size];
    if ('input' in node) return [node.input];
    if ('left' in node) return [node.left, node.right];
    return [];
}
function remap(node: RamNode, ids: Map<number, number>): RamNode {
    const id = (n: number) => ids.get(n)!;
    if (node.kind === 'concat') return {...node, operands: node.operands.map(id)};
    if (node.kind === 'transpose') return {...node, input: id(node.input), permutation: id(node.permutation)};
    if (node.kind === 'slice') return {...node, input: id(node.input), begin: id(node.begin), size: id(node.size)};
    if ('input' in node) return {...node, input: id(node.input)};
    if ('left' in node) return {...node, left: id(node.left), right: id(node.right)};
    return node;
}
export function ramGraph(precision: RamGraph['precision'], nodes: readonly RamNode[], output: number,
    inputs: RamGraph['inputs'], shape: readonly number[]): RamGraph {
    const model = ramModel(nodes, output);
    const weights = new Set(nodes.flatMap(n => n.kind === 'linear' ? [n.right] : []));
    const bytes = (n: RamNode) => size(n.shape) * 4;
    const reservationBytes = model.length + nodes.reduce((sum, n) => sum + bytes(n), 0)
        + [...weights].reduce((sum, i) => sum + bytes(nodes[i]), 0);
    return {precision, nodes, output, inputs, shape, model, outputShape: nodes[output].shape, reservationBytes};
}

/** Single-output parts. Grow backwards only when every consumer is in the part:
 * shared operations therefore execute once, and crossing edges become states.
 * Constants stay baked, including integer structural operands and linear weights. */
export function partitionRam(precision: RamGraph['precision'], nodes: readonly RamNode[], output: number,
    inputs: RamGraph['inputs'], shape: readonly number[]): RamGraph {
    if (nodes.length <= 128) return ramGraph(precision, nodes, output, inputs, shape);
    if (precision !== 'f32') throw new RankError('Partitioned RAM graphs require .f32', 'RamCompile');
    const reachable = new Set<number>([output]);
    for (let i = output; i >= 0; i--) if (reachable.has(i)) ramDependencies(nodes[i]).forEach(n => reachable.add(n));
    const consumers = nodes.map(() => new Set<number>());
    for (const i of reachable) for (const dep of ramDependencies(nodes[i])) consumers[dep].add(i);
    const remaining = new Set([...reachable].filter(i => nodes[i].kind !== 'input' && nodes[i].kind !== 'constant'));
    const specs = new Map<number, RamGraph['inputs'][number]>();
    let inputIndex = 0;
    nodes.forEach((n, i) => { if (n.kind === 'input') specs.set(i, inputs[inputIndex++]); });
    const parts: RamPart[] = [];
    while (remaining.size) {
        const target = Math.max(...remaining), included = new Set([target]);
        let dependencies = new Set(ramDependencies(nodes[target]));
        if (dependencies.size + 1 > 128) throw new RankError('A RAM operation exceeds the 128-tensor part limit', 'RamCompile');
        for (let i = target - 1; i >= 0; i--) {
            if (!dependencies.has(i) || !remaining.has(i) || [...consumers[i]].some(c => !included.has(c))) continue;
            const expanded = new Set([...dependencies, ...ramDependencies(nodes[i])]);
            if (new Set([...included, ...expanded, i]).size > 128) continue;
            included.add(i); dependencies = expanded;
        }
        const all = [...new Set([...included, ...dependencies])].sort((a, b) => a - b);
        const ids = new Map(all.map((n, i) => [n, i]));
        const external = all.filter(i => !included.has(i) && nodes[i].kind !== 'constant');
        const localNodes = all.map(i => included.has(i) || nodes[i].kind === 'constant'
            ? remap(nodes[i], ids) : {kind: 'input' as const, shape: nodes[i].shape,
                ...(nodes[i].kind === 'input' && nodes[i].dtype === 'i32' ? {dtype: 'i32' as const} : {})});
        const localInputs = external.map(i => specs.get(i) ?? {name: 't' + i, shape: nodes[i].shape});
        const graph = ramGraph(precision, localNodes, ids.get(target)!, localInputs, localInputs[0]?.shape ?? []);
        parts.push({graph, inputs: external, output: target});
        included.forEach(i => remaining.delete(i));
    }
    parts.reverse();
    // A composite has no standalone model. Only its parts are submitted to the host.
    return {precision, nodes, output, inputs, shape, outputShape: nodes[output].shape,
        model: new Uint8Array(), reservationBytes: Math.max(...parts.map(p => p.graph.reservationBytes)), parts};
}

/** Internal states never enter Rank values. Borrowed caller states are not owned here. */
export function executeRamGraph(graph: RamGraph, gpu: RamGpu, input: readonly number[],
    files?: readonly (FileTensorInput | null)[], options?: {inputStates?: readonly (string | null)[]; retainOutput?: boolean}): readonly number[] | RamStateDescriptor {
    if (!graph.parts) return gpu(graph, input, files, options);
    if (!gpu.control) throw new RankError('Partitioned RAM graphs require GPU state support', 'GpuUnavailable');
    const original = new Map<number, {values: readonly number[]; file: FileTensorInput | null; state: string | null}>();
    let offset = 0, index = 0;
    graph.nodes.forEach((node, id) => {
        if (node.kind !== 'input') return;
        const file = files?.[index] ?? null, state = options?.inputStates?.[index] ?? null;
        const count = file || state ? 0 : size(node.shape);
        original.set(id, {values: input.slice(offset, offset + count), file, state});
        offset += count; index++;
    });
    const lastUse = new Map<number, number>();
    graph.parts.forEach((part, i) => part.inputs.forEach(id => lastUse.set(id, i)));
    const states = new Map<number, RamStateDescriptor>();
    const release = (id: number) => {
        const state = states.get(id)!;
        gpu.control!({action: 'releaseState', stateId: state.id});
        states.delete(id);
    };
    let failed = false;
    try {
        for (let i = 0; i < graph.parts.length; i++) {
            checkInterrupt();
            const part = graph.parts[i], values: number[] = [], inputFiles: (FileTensorInput | null)[] = [], inputStates: (string | null)[] = [];
            for (const id of part.inputs) {
                const supplied = original.get(id);
                if (supplied) { for (const value of supplied.values) values.push(value); inputFiles.push(supplied.file); inputStates.push(supplied.state); }
                else {
                    const state = states.get(id);
                    if (!state) throw new RankError('Missing intermediate GPU state', 'GpuExecution');
                    inputFiles.push(null); inputStates.push(state.id);
                }
            }
            const final = i === graph.parts.length - 1, retain = !final || options?.retainOutput;
            const result = gpu(part.graph, values, inputFiles.some(Boolean) ? inputFiles : undefined,
                {inputStates, ...(retain ? {retainOutput: true} : {})});
            if ('id' in result) {
                states.set(part.output, result);
                if (!retain || result.dtype !== 'f32' || result.shape.length !== part.graph.outputShape.length
                    || result.shape.some((n, j) => n !== part.graph.outputShape[j]))
                    throw new RankError('Invalid intermediate GPU state', 'GpuExecution');
            } else if (retain) throw new RankError('GPU runtime did not retain the intermediate output', 'GpuExecution');
            for (const id of part.inputs) if (states.has(id) && lastUse.get(id) === i) release(id);
            if (final) { states.delete(part.output); return result; }
        }
        throw new RankError('Empty RAM execution plan', 'GpuExecution');
    } catch (error) { failed = true; throw error; }
    finally {
        let cleanupError: unknown;
        for (const id of states.keys()) try { release(id); } catch (error) { cleanupError ??= error; }
        if (!failed && cleanupError) throw cleanupError;
    }
}
