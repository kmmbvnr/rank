import { isApplicationExpression, isParenthesizedExpression, isNameExpression,
    isNumberLiteral, isBinaryExpression, isAllAxisExpression, type Expression } from '@arrrank/language';
import type { RamNode } from './ram-model.js';

/** Static subset of Rank's structural syntax. No host evaluation or dynamic shapes. */
export function lowerRamStructure(expression: Expression, nodes: readonly RamNode[],
    lower: (expression: Expression) => number, append: (node: RamNode) => number,
    fail: (message: string) => never, validShape: (shape: number[]) => number,
    precision: string): number | undefined {
    const unwrap = (e: Expression): Expression => isParenthesizedExpression(e) ? unwrap(e.value) : e;
    const parts: Expression[] = [];
    let head = expression;
    while (isApplicationExpression(head)) {
        parts.unshift(...head.arguments); head = head.head;
    }
    parts.unshift(head);
    const named = (e: Expression | undefined, name: string) => !!e && isNameExpression(e) && e.name === name;
    const integer = (e: Expression): number => {
        e = unwrap(e);
        if (!isNumberLiteral(e) || typeof e.value !== 'bigint' || e.value < 0n || e.value > 1048576n)
            return fail('RAM structural arguments require nonnegative integer literals');
        return Number(e.value);
    };
    const ints = (values: number[]) => append({kind:'constant',dtype:'i32',shape:[values.length],values});
    const fp32 = () => { if (precision !== 'f32') fail('RAM structural operations require .f32'); };
    if (named(parts[1], 'reshape')) {
        fp32(); const input = lower(parts[0]), shape = parts.slice(2).map(integer);
        if (validShape(shape) !== nodes[input].shape.reduce((a,b)=>a*b,1))
            fail('RAM reshape must preserve element count');
        return append({kind:'reshape',input,shape});
    }
    if (named(parts[1], 'transpose')) {
        fp32(); const input = lower(parts[0]), source = nodes[input].shape;
        const axes = parts.length === 2 ? source.map((_,i)=>source.length-1-i)
            : named(parts[2], 'axis') ? parts.slice(3).map(integer) : fail('RAM transpose expects axis permutation');
        if (axes.length !== source.length || new Set(axes).size !== axes.length || axes.some(i=>i>=source.length))
            fail('RAM transpose requires a permutation of all axes');
        if (axes.every((axis, i) => axis === i)) return append({kind:'reshape',input,shape:source});
        return append({kind:'transpose',input,permutation:ints(axes),shape:axes.map(i=>source[i])});
    }
    if (named(parts[0], 'concat')) {
        fp32(); const modifier = parts.findIndex(e=>named(e,'axis'));
        const axis = modifier < 0 ? 0 : parts.length === modifier+2 ? integer(parts[modifier+1]) : fail('RAM concat expects one axis');
        const operands = parts.slice(1,modifier<0?undefined:modifier).map(lower);
        if (operands.length < 2) fail('RAM concat requires at least two tensors');
        const shape = [...nodes[operands[0]].shape];
        if (axis >= shape.length) fail('RAM concat axis is out of bounds');
        for (const operand of operands.slice(1)) {
            const other = nodes[operand].shape;
            if (other.length !== shape.length || other.some((n,i)=>i!==axis && n!==shape[i]))
                fail('RAM concat requires matching non-concatenated dimensions');
            shape[axis] += other[axis];
        }
        validShape(shape); return append({kind:'concat',operands,axis,shape});
    }
    const matmul = parts.findIndex(e=>named(e,'matmul'));
    if (matmul >= 0) {
        fp32();
        if (matmul !== 2 || parts.length < 3) fail('RAM matmul expects X matmul Y');
        const batched = parts.length === 6 && named(parts[3],'rank')
            && integer(parts[4])===2 && integer(parts[5])===2;
        if (parts.length !== 3 && !batched) fail('RAM matmul supports only rank 2 2');
        const left = lower(parts[0]), right = lower(parts[1]);
        const a=nodes[left].shape,b=nodes[right].shape;
        if (a.length<2 || b.length<2 || a.at(-1)!==b.at(-2)) fail('RAM matmul requires matching contracted dimensions');
        if (!batched && (a.length!==2 || b.length!==2)) fail('RAM batched matmul requires rank 2 2');
        const rank=Math.max(a.length,b.length),shape:number[]=[];
        for(let i=0;i<rank-2;i++) {
            const x=a[i-(rank-a.length)]??1,y=b[i-(rank-b.length)]??1;
            if(x!==y && x!==1 && y!==1) fail('RAM matmul requires compatible batch dimensions');
            shape.push(Math.max(x,y));
        }
        shape.push(a.at(-2)!,b.at(-1)!); validShape(shape);
        // Metal's implicit batch expansion produces incorrect values for crossed
        // singleton axes. Expand explicitly on the GPU before BATCH_MATMUL.
        const expand = (input: number): number => {
            let dimensions = [...Array(rank-nodes[input].shape.length).fill(1), ...nodes[input].shape];
            if (dimensions.length !== nodes[input].shape.length)
                input = append({kind:'reshape',input,shape:dimensions});
            for (let axis=0; axis<rank-2; axis++) {
                if (dimensions[axis] === shape[axis]) continue;
                let remaining=shape[axis], chunk=input, width=1;
                const operands:number[]=[];
                while (remaining) {
                    if (remaining%2) operands.push(chunk);
                    remaining=Math.floor(remaining/2);
                    if (remaining) {
                        width*=2;
                        chunk=append({kind:'concat',operands:[chunk,chunk],axis,
                            shape:dimensions.map((n,i)=>i===axis?width:n)});
                    }
                }
                dimensions=dimensions.map((n,i)=>i===axis?shape[axis]:n);
                validShape(dimensions);
                input=operands.length===1?operands[0]:append({kind:'concat',operands,axis,shape:dimensions});
            }
            return input;
        };
        return append({kind:'matmul',left:expand(left),right:expand(right),shape});
    }
    // Positional ranges preserve axes; # and omitted trailing selectors keep them whole.
    const selector = (e: Expression) => {
        e = unwrap(e);
        return isAllAxisExpression(e) || (isBinaryExpression(e) && ['to','till'].includes(e.operator));
    };
    if (parts.length>1 && parts.slice(1).some(selector)) {
        fp32(); const input=lower(parts[0]), shape=[...nodes[input].shape], begin=shape.map(()=>0);
        if (parts.length-1>shape.length) fail('Too many RAM slice selectors');
        parts.slice(1).forEach((e,axis)=>{
            e=unwrap(e); if(isAllAxisExpression(e)) return;
            if(!isBinaryExpression(e) || !['to','till'].includes(e.operator)) fail('RAM slices support only # and static ranges');
            if(!isBinaryExpression(e)) return;
            const start=integer(e.left),end=integer(e.right)+(e.operator==='to'?1:0);
            if(start>=end || end>shape[axis]) fail('RAM slice must be nonempty and within the input shape');
            begin[axis]=start; shape[axis]=end-start;
        });
        return append({kind:'slice',input,begin:ints(begin),size:ints(shape),shape});
    }
    return undefined;
}
