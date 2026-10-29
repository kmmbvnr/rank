import type {RamGraph} from './mlrank.js';
import type {FileTensorInput} from './file-tensor.js';
import type {RamNode} from './ram-model.js';
import {partitionRam, ramDependencies, remapRamNode} from './ram-plan.js';
import {RankError} from './errors.js';

interface FileView { source: number; offset: number; shape: readonly number[] }
interface Binding { source: number; view?: FileView }
interface BoundPlan { key: string; graph: RamGraph; bindings: Binding[] }
const plans = new WeakMap<RamGraph, BoundPlan>();
const count = (shape: readonly number[]) => shape.reduce((a,b)=>a*b,1);

/** Prove contiguous views using logical row-major coordinates. A transpose or
 * arithmetic result is not a file view; noncontiguous slices stay GPU operations. */
function filePlan(graph: RamGraph, files: readonly (FileTensorInput|null)[], key: string): BoundPlan {
    const views = new Map<number, FileView>(), sources = new Map<number,number>();
    let source = 0;
    graph.nodes.forEach((node,id)=>{
        if (node.kind === 'input') {
            sources.set(id,source);
            if (files[source]) views.set(id,{source,offset:0,shape:node.shape});
            source++; return;
        }
        if (node.kind !== 'reshape' && node.kind !== 'slice') return;
        const parent = views.get(node.input);
        if (!parent) return;
        if (node.kind === 'reshape') { views.set(id,{...parent,shape:node.shape}); return; }
        const begin = graph.nodes[node.begin], dimensions = graph.nodes[node.size];
        if (begin.kind !== 'constant' || dimensions.kind !== 'constant') return;
        let first = 0, last = 0, stride = 1;
        for (let axis=parent.shape.length-1; axis>=0; axis--) {
            first += begin.values[axis]*stride;
            last += (begin.values[axis]+dimensions.values[axis]-1)*stride;
            stride *= parent.shape[axis];
        }
        if (last-first+1 === count(node.shape)) views.set(id,{source:parent.source,offset:parent.offset+first,shape:node.shape});
    });
    const reachable = new Set([graph.output]);
    for (let id=graph.output; id>=0; id--) if (reachable.has(id) && !views.has(id))
        ramDependencies(graph.nodes[id]).forEach(dep=>reachable.add(dep));
    const all = [...reachable].sort((a,b)=>a-b), ids = new Map(all.map((id,i)=>[id,i]));
    const nodes: RamNode[] = [], inputs: RamGraph['inputs'][number][] = [], bindings: Binding[] = [];
    for (const id of all) {
        const node = graph.nodes[id], view = views.get(id), source = sources.get(id);
        if (view) {
            // Native inputs remain bounded. Large files are represented by ranges,
            // never by relaxing native allocation limits or reading into JS.
            if (count(view.shape)>4_194_304) throw new RankError('RAM file range exceeds 16 MiB; select smaller contiguous ranges inside the module', 'GpuMemory');
            nodes.push({kind:'input',shape:view.shape});
            inputs.push({name:'file'+id,shape:view.shape});bindings.push({source:view.source,view});
        } else {
            nodes.push(remapRamNode(node,ids));
            if (source !== undefined) { inputs.push(graph.inputs[source]);bindings.push({source}); }
        }
    }
    let output = ids.get(graph.output)!;
    if (views.has(graph.output)) {
        nodes.push({kind:'reshape',input:output,shape:graph.outputShape});output=nodes.length-1;
    }
    return {key,graph:partitionRam(graph.precision,nodes,output,inputs,inputs[0]?.shape??[]),bindings};
}

/** Bind only file metadata. Paths, revisions and offsets are refreshed each call;
 * native model identities depend on the graph, not on the selected file contents. */
export function bindRamFiles(graph: RamGraph, input: readonly number[], files?: readonly (FileTensorInput|null)[],
    options?: {inputStates?: readonly (string|null)[];retainOutput?:boolean}) {
    if (!files?.some(Boolean)) return {graph,input,files,options};
    if (graph.precision !== 'f32') throw new RankError('RAM file inputs require .f32', 'TypeError');
    files.forEach((file,i)=>{
        if (!file) return;
        const shape = graph.inputs[i].shape;
        if (file.dtype!=='F32' || file.shape.length!==shape.length || file.shape.some((n,j)=>n!==shape[j])
            || file.length!==count(shape)*4 || !Number.isSafeInteger(file.offset) || file.offset<0
            || !Number.isSafeInteger(file.fileSize) || file.offset+file.length>file.fileSize)
            throw new RankError('Invalid RAM file tensor descriptor', 'TypeError');
    });
    const key = files.map(file=>file?'1':'0').join('');
    let plan = plans.get(graph);
    if (!plan || plan.key!==key) { plan=filePlan(graph,files,key);plans.set(graph,plan); }
    const inline: (readonly number[])[] = [];
    let offset=0;
    graph.inputs.forEach((spec,i)=>{
        const length=files[i]||options?.inputStates?.[i]?0:count(spec.shape);
        inline.push(input.slice(offset,offset+length));offset+=length;
    });
    const values:number[]=[], ranges:(FileTensorInput|null)[]=[], states:(string|null)[]=[];
    for (const binding of plan.bindings) {
        if (binding.view) {
            const file=files[binding.source]!, view=binding.view;
            ranges.push({...file,offset:file.offset+view.offset*4,length:count(view.shape)*4,shape:view.shape});states.push(null);
        } else {
            ranges.push(null);states.push(options?.inputStates?.[binding.source]??null);
            for (const value of inline[binding.source]) values.push(value);
        }
    }
    return {graph:plan.graph,input:values,files:ranges,options:{...options,inputStates:states}};
}
