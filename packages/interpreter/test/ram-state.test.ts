import {describe,it,expect} from 'vitest';
import {Interpreter,type RamGpu} from '../src/index.js';
describe('explicit retained GPU state',()=>{
    function host() {
        const saved=new Map<string,number[]>(); let id=0,reads=0;
        const gpu:RamGpu=(_g,input,_files,options)=>{
            const values=options?.inputStates?.[0]?saved.get(options.inputStates[0])!:input;
            if(options?.retainOutput){const key=String(++id);saved.set(key,[...values]);return {id:key,shape:[1,2],dtype:'f32'};}
            return [...values];
        };
        gpu.control=r=>{if(r.action==='releaseState'){saved.delete(r.stateId);return {};}reads++;return {output:saved.get(r.stateId)};};
        const runtime=new Interpreter(undefined,{ramGpu:gpu,loadModule:n=>({id:n,source:'use ml\narg X .f32 shape 1 2\nreturn X relu'})});
        return {runtime,saved,reads:()=>reads};
    }
    it('retains without reading, passes handles, reads explicitly and invalidates aliases',()=>{
        const {runtime,saved,reads}=host();
        try{
            runtime.execute('use ml\nuse "hold.ram"\nkeep = (hold gpukeep)\nState = (array 2.0 3.0 shape 1 2) keep\nAlias = State');
            expect(reads()).toBe(0);expect(saved.size).toBe(1);
            expect(runtime.execute('State hold')).toMatchObject({items:[2,3]});
            expect(runtime.execute('State gpuread')).toMatchObject({items:[2,3],shape:[1,2]});
            expect(reads()).toBe(1);
            expect(runtime.execute('State gpufree')).toBe(true);
            expect(()=>runtime.execute('Alias gpuread')).toThrow(/released/);
            expect(()=>runtime.execute('Alias hold')).toThrow(/released/);
            expect(saved.size).toBe(0);
        }finally{runtime.dispose();}
    });
    it('releases retained states when the interpreter is disposed',()=>{
        const {runtime,saved}=host();
        runtime.execute('use ml\nuse "hold.ram"\nkeep = (hold gpukeep)\nState = (array 2.0 3.0 shape 1 2) keep');
        expect(saved.size).toBe(1);runtime.dispose();expect(saved.size).toBe(0);
    });
    it('keeps multiple operands in the same order across notebook cells',()=>{
        const gpu:RamGpu=(_g,input)=>{expect(input).toEqual([1,2,3,4]);return {id:'multi',shape:[1,2],dtype:'f32'};};
        gpu.control=()=>({});
        const runtime=new Interpreter(undefined,{ramGpu:gpu,loadModule:n=>({id:n,source:'use ml\narg X .f32 shape 1 2\narg W .f32 shape 1 2\nreturn X + W'})});
        try {
            for(const cell of ['use ml','use "hold.ram"','keep = (hold gpukeep)',
                'S = (array 1.0 2.0 shape 1 2) keep (array 3.0 4.0 shape 1 2)','S gpufree'])
                runtime.execute(cell);
            runtime.execute('again = (hold gpukeep)\nT = (array 1.0 2.0 shape 1 2) again (array 3.0 4.0 shape 1 2)\nT gpufree');
        }finally{runtime.dispose();}
    });
    it('rejects non-RAM factories and ordinary arrays as handles',()=>{
        const {runtime}=host();
        try{
            expect(()=>runtime.execute('use ml\nf = (relu gpukeep)')).toThrow(/RAM function/);
            expect(()=>runtime.execute('(array 1 2) gpuread')).toThrow(/retained GPU/);
        }finally{runtime.dispose();}
    });
});
