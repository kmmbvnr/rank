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
    inputs: RamGraph['inputs'], shape: readonly number[], partBudget = Infinity): RamGraph {
    if (nodes.length <= 128) {
        const single = ramGraph(precision, nodes, output, inputs, shape);
        if (single.reservationBytes <= partBudget) return single;
    }
    if (precision !== 'f32') throw new RankError('Partitioned RAM graphs require .f32', 'RamCompile');
    const reachable = new Set<number>([output]);
    for (let i = output; i >= 0; i--) if (reachable.has(i)) ramDependencies(nodes[i]).forEach(n => reachable.add(n));
    const consumers = nodes.map(() => new Set<number>());
    for (const i of reachable) for (const dep of ramDependencies(nodes[i])) consumers[dep].add(i);
    const remaining = new Set([...reachable].filter(i => nodes[i].kind !== 'input' && nodes[i].kind !== 'constant'));
    const specs = new Map<number, RamGraph['inputs'][number]>();
    let inputIndex = 0;
    nodes.forEach((n, i) => { if (n.kind === 'input') specs.set(i, inputs[inputIndex++]); });
    // Conservative serialization allowance avoids repeatedly copying baked weights
    // while considering cuts. Final admission uses the actual serialized length.
    const estimate = (ids: Set<number>, included: Set<number>) => {
        let bytes = 2048 + ids.size * 256;
        const transposed = new Set<number>();
        for (const id of ids) {
            const node = nodes[id]; bytes += size(node.shape) * 4;
            if (node.kind === 'constant') bytes += size(node.shape) * 4;
            if (included.has(id) && node.kind === 'linear') transposed.add(node.right);
        }
        for (const id of transposed) bytes += size(nodes[id].shape) * 8 + 256;
        return bytes;
    };
    const parts: RamPart[] = [];
    while (remaining.size) {
        const target = Math.max(...remaining), included = new Set([target]);
        let dependencies = new Set(ramDependencies(nodes[target]));
        if (dependencies.size + 1 > 128) throw new RankError('A RAM operation exceeds the 128-tensor part limit', 'RamCompile');
        if (estimate(new Set([target, ...dependencies]), included) > partBudget)
            throw new RankError('RAM memory budget cannot fit an operation and its inputs', 'GpuMemory');
        for (let i = target - 1; i >= 0; i--) {
            if (!dependencies.has(i) || !remaining.has(i) || [...consumers[i]].some(c => !included.has(c))) continue;
            const expanded = new Set([...dependencies, ...ramDependencies(nodes[i])]);
            const candidate = new Set([...included, ...expanded, i]);
            if (candidate.size > 128 || estimate(candidate, new Set([...included, i])) > partBudget) continue;
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
        if (graph.reservationBytes > partBudget) throw new RankError('RAM serialized part exceeds memory budget', 'GpuMemory');
        parts.push({graph, inputs: external, output: target});
        included.forEach(i => remaining.delete(i));
    }
    parts.reverse();
    // A composite has no standalone model. Only its parts are submitted to the host.
    return {precision, nodes, output, inputs, shape, outputShape: nodes[output].shape,
        model: new Uint8Array(), reservationBytes: Math.max(...parts.map(p => p.graph.reservationBytes)), parts};
}

/** Working-set admission excludes evictable cached models. Caller states are
 * subtracted by the executor, including states unrelated to this graph. */
export function planRamMemory(graph: RamGraph, budgetBytes: number, stateSlots: number, retainOutput = false): RamGraph {
    if (!Number.isSafeInteger(budgetBytes) || budgetBytes < 1 || !Number.isSafeInteger(stateSlots) || stateSlots < 0)
        throw new RankError('RAM memory budget is exhausted or invalid', 'GpuMemory');
    let plan = graph, partBudget = budgetBytes;
    for (let attempt = 0; attempt < 32; attempt++) {
        const parts = plan.parts ?? [{graph:plan, inputs:[], output:plan.output}];
        const lastUse = new Map<number, number>();
        parts.forEach((p,i) => p.inputs.forEach(id => lastUse.set(id,i)));
        const live = new Map<number, number>();
        let peakBytes=0, peakStateBytes=0, peakStates=0;
        parts.forEach((part,i) => {
            if (i < parts.length-1 || retainOutput) live.set(part.output, size(part.graph.outputShape)*4);
            const stateBytes = [...live.values()].reduce((a,b)=>a+b,0);
            peakBytes = Math.max(peakBytes, part.graph.reservationBytes + stateBytes);
            peakStateBytes = Math.max(peakStateBytes,stateBytes); peakStates = Math.max(peakStates,live.size);
            for (const id of part.inputs) if (lastUse.get(id)===i) live.delete(id);
        });
        if (peakStates > stateSlots) throw new RankError('RAM memory plan exceeds available GPU state slots', 'GpuMemory');
        if (peakBytes <= budgetBytes) return {...plan,memoryPlan:{budgetBytes,peakBytes,peakStateBytes,peakStates}};
        partBudget = Math.min(partBudget-1, budgetBytes-peakStateBytes);
        if (partBudget <= 0) throw new RankError('RAM memory budget cannot fit the execution plan', 'GpuMemory');
        plan = partitionRam(graph.precision,graph.nodes,graph.output,graph.inputs,graph.shape,partBudget);
    }
    throw new RankError('RAM memory planner could not find a bounded execution plan', 'GpuMemory');
}
const memoryPlans = new WeakMap<RamGraph, {key:string;plan:RamGraph}>();

/** Internal states never enter Rank values. Borrowed caller states are not owned here. */
export function executeRamGraph(graph: RamGraph, gpu: RamGpu, input: readonly number[],
    files?: readonly (FileTensorInput | null)[], options?: {inputStates?: readonly (string | null)[]; retainOutput?: boolean}): readonly number[] | RamStateDescriptor {
    if (gpu.memory) {
        const memory = gpu.memory(), available = memory.memoryBudgetBytes-memory.stateBytes;
        const slots = memory.maxStates-memory.residentStates;
        const key = `${available}/${slots}/${!!options?.retainOutput}`;
        let cached = memoryPlans.get(graph);
        if (!cached || cached.key !== key) {
            cached = {key,plan:planRamMemory(graph,available,slots,!!options?.retainOutput)};
            memoryPlans.set(graph,cached);
        }
        // Keep the native model identity when only admission metadata changed.
        if (cached.plan.parts) graph = cached.plan;
    }
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
