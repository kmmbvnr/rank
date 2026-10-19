import { GraphValue } from '../src/graph.js';
import { describe, expect, it } from 'vitest';
import { Interpreter, RuntimeDiagnostics, formatValue, RankError, withInterrupt, InterruptedError } from '../src/index.js';
import type { InterpreterOptions } from '../src/interpreter-options.js';

function execute(source: string, options: InterpreterOptions = {}) {
    const diagnostics = new RuntimeDiagnostics();
    let calls = 0, error: string | undefined;
    const measured = new Interpreter(() => {}, { ...options, onScalarFunctionExecuted: () => calls++ });
    try {
        try { diagnostics.run(() => measured.execute(source)); }
        catch (failure) { error = failure instanceof RankError ? failure.format() : String(failure); }
        const graphs = [...measured.variables].flatMap(([name, value]) => value instanceof GraphValue
            ? [[name, [...value.adjacency].map(([key, edges]) => [key,
                edges.map(edge => [formatValue(edge.target), formatValue(edge.weight), edge.id])])]] : []);
        const variables = [...measured.variables].map(([name, value]) => [name, formatValue(value)]);
        return { diagnostics, calls, observation: { error, graphs, variables } };
    } finally { measured.dispose(); }
}
function compare(source: string) {
    const candidate = execute(source);
    expect(candidate.observation).toEqual(execute(source, { compilation: false }).observation);
    expect(candidate.observation.error).toBeUndefined();
    return candidate;
}

describe('compiled collection operations', () => {
    it.each(['in', 'not in'])('prepares %s once per array filter and preserves order and duplicates', operator => {
        const source = `Vals = array 4 2 4 3 1\nDomain = array 4 1 4\nNeighbors = Domain take 2\nLater = Vals drop 1\nNext = Later filter ${operator} Neighbors\nAnswer = Next array`;
        const result = compare(source);
        expect(result.diagnostics.integerMembershipFilters).toBe(1);
        expect(result.diagnostics.fallbacks['scalar-expression:unsupported-op:in']).toBeUndefined();
        expect(result.observation.variables.at(-1)).toEqual(['Answer', operator === 'in' ? '4 1' : '2 3']);
    });

    it('uses immutable integer neighbor snapshots on either side of membership', () => {
        const result = compare(`use graph
Graph = new graph (array 1 2 3 4) .undirected
Graph add 1 3
Graph add 1 2
Graph add 1 3
Neighbors = Graph 1
Graph add 1 4
Vals = array 4 3 2 1
Domain = Vals take 3
Next = Neighbors filter greater 1 filter in Domain
Answer = Next array
Other = Vals filter in Neighbors
OtherAnswer = Other array`);
        expect(result.diagnostics.integerMembershipFilters).toBe(2);
        expect(result.observation.variables.slice(-3)).toContainEqual(['Answer', '3 2 3']);
        expect(result.observation.variables.at(-1)).toEqual(['OtherAnswer', '3 2']);
    });

    it('observes array changes between independent preparations', () => {
        const result = compare('Vals = array 1 2 3\nDomain = array 1 2\nA = Vals filter in Domain array\nDomain 0 = 3\nB = Vals filter in Domain array');
        expect(result.observation.variables.at(-1)).toEqual(['B', '2 3']);
        expect(result.diagnostics.integerMembershipFilters).toBe(2);
    });

    it('retains generic mixed, empty and structural membership', () => {
        compare('Vals = array 1 2 3\nDomain = array 2.0\nAnswer = Vals filter in Domain array');
        compare('Vals = array shape 0 fill 0\nDomain = array 2\nAnswer = Vals filter not in Domain array');
        compare('Vals = array "a" "b"\nDomain = array "b"\nAnswer = Vals filter in Domain array');
    });

    it.each(['in', 'not in'])('links captured array %s inside scalar kernels', operator => {
        const result = compare(`Domain = array 2 4\nfun X member\n return X ${operator} Domain\nend\nAnswer = 2 member\nDomain 0 = 3\nOther = 2 member`);
        expect(result.calls).toBeGreaterThan(0);
        expect(result.observation.variables.at(-1)).toEqual(['Other', operator === 'in' ? 'false' : 'true']);
    });

    it('compiles integer-array membership parameters in linked scalar calls', () => {
        const result = compare(`fun X Domain member\n return X in Domain\nend\nDomain = array 2 4\nS = 0\nfor I in 1 to 5\n if I Domain member\n  S += 1\n end\nend`);
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.observation.variables.at(-1)).toEqual(['S', '2']);
    });
    it('compiles indexed suffix traversal with independent relative ordinals', () => {
        const source = `Vals = 1 to 30 array
S = 0
for P i in Vals
 for Q Index in Vals drop (i + 1)
  if (P + Q) mod 7 equal 0
   S += 1
  end
  Index = 99
 end
end`;
        const result = compare(source);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.observation).toEqual(execute(source, { numberLoopCompilation: false }).observation);
        expect(result.observation.variables.at(-1)).toEqual(['S', '62']);
    });

    it.each(['take 0', 'drop 0', 'take 99', 'drop 99', 'drop 999999999999999999999'])('retains slice boundaries for %s', clause => {
        const source = `Vals = array 10 20 30\nS = 0\nfor V Index in Vals ${clause}\n S += V + Index\nend`;
        const result = compare(source);
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.observation).toEqual(execute(source, { numberLoopCompilation: false }).observation);
    });

    it('evaluates nested slice bounds at traversal entry and preserves control flow', () => {
        const source = `Vals = array 10 20 30 40
S = 0
Count = 0
for Outer in 0 to 2
 for V Index in Vals drop Count
  Count = 99
  if Index equal 0
   continue
  end
  S += V + Index
  break
 end
 Count = Outer
end`;
        const result = compare(source);
        expect(result.diagnostics.numberLoops).toBe(1);
        expect(result.observation).toEqual(execute(source, { numberLoopCompilation: false }).observation);
    });

    it.each(['take (-1)', 'drop (-1)'])('keeps preceding assignments and errors for %s', clause => {
        const source = `Vals = array 1 2\nBefore = 0\nfor Outer in 0 to 1\n Before += 1\n for V in Vals ${clause}\n  Before += V\n end\nend`;
        const candidate = execute(source);
        expect(candidate.observation).toEqual(execute(source, { compilation: false }).observation);
        expect(candidate.observation).toEqual(execute(source, { numberLoopCompilation: false }).observation);
        expect(candidate.observation.error).toContain('nonnegative integer count');
    });

    it.each(['directed', 'undirected'])('compiles graph edge effects for %s graphs', direction => {
        const result = compare(`use graph
Graph = new graph (1 to 30 array) .${direction}
for P in 1 to 30
 for Q in (P + 1) to 30
  if (P + Q) mod 7 equal 0
   Graph add P Q
  end
 end
end
Answer = (Graph 1) array`);
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.diagnostics.numberLoops).toBe(0);
        let edges = 0;
        for (let p = 1; p <= 30; p++) for (let q = p + 1; q <= 30; q++) if ((p + q) % 7 === 0) edges++;
        expect(result.diagnostics.compiledGraphAdds).toBe(edges);
        expect(result.observation.variables.at(-1)).toEqual(['Answer', '6 13 20 27']);
    });

    it('combines suffix traversal with graph effects and exact arithmetic without replay', () => {
        const source = `use graph
Vals = array 1 2 3
Graph = new graph Vals .undirected
S = 9007199254740991
for P Index in Vals
 for Q in Vals drop (Index + 1)
  Graph add P Q
  S += 1
 end
end
Answer = (Graph 1) array`;
        const result = compare(source);
        expect(result.diagnostics.compiledLoops).toBe(1);
        expect(result.diagnostics.compiledGraphAdds).toBe(3);
        expect(result.diagnostics.numberLoops).toBe(0);
        expect(result.observation.variables).toContainEqual(['S', '9007199254740994']);
        expect(result.observation.variables.at(-1)).toEqual(['Answer', '2 3']);
    });

    it('preserves weighted parallel edges, self-loops and insertion order', () => {
        const result = compare(`use graph
Graph = new graph .undirected
for I in 1 to 2
 Graph add 1 2 I
 Graph add 1 1
end
Answer = (Graph 1) array`);
        expect(result.diagnostics.compiledGraphAdds).toBe(4);
        expect(result.observation.variables.at(-1)).toEqual(['Answer', '2 1 2 1']);
    });

    it('publishes preceding scalar writes and graph effects before a failure', () => {
        const source = `use graph
Graph = new graph (array 1 2 3) .directed
Before = 0
After = -1
for I in 1 to 4
 Before += 1
 Graph add 1 I
 After = I
end`;
        const candidate = execute(source);
        expect(candidate.observation).toEqual(execute(source, { compilation: false }).observation);
        expect(candidate.observation.error).toContain('graph does not contain the vertex');
        expect(candidate.diagnostics.compiledLoops).toBe(1);
        expect(candidate.observation.variables).toContainEqual(['Before', '4']);
        expect(candidate.observation.variables).toContainEqual(['After', '3']);
    });

    it('keeps a prepared lazy sequence mask fixed across later domain writes', () => {
        const result = compare(`use graph
Graph = new graph .directed
Graph add 1 2
Graph add 1 3
Domain = array 2 4
Next = (Graph 1) filter in Domain
Domain 0 = 3
Answer = Next array`);
        expect(result.observation.variables.at(-1)).toEqual(['Answer', '2']);
    });

    it('does not bind a stale array membership index across writes in a loop', () => {
        const source = `Domain = array 1 2
Alias = Domain
S = 0
for I in 1 to 3
 Domain 0 = I
 if I in Domain
  S += 1
 end
end`;
        const result = compare(source);
        expect(result.observation.variables).toContainEqual(['S', '3']);
        expect(result.observation.variables).toContainEqual(['Alias', '1 2']);
    });

    it('reads a captured domain after a linked caller replaces its COW storage', () => {
        const result = compare(`Domain = array 1 2
Alias = Domain
fun X member
 return X in Domain
end
S = 0
for I in 1 to 3
 Domain 0 = I
 if I member
  S += 1
 end
end`);
        expect(result.observation.variables).toContainEqual(['S', '3']);
        expect(result.observation.variables).toContainEqual(['Alias', '1 2']);
    });

    it('declines overridden graph mutation methods before any compiled effects', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use graph\nGraph = new graph .directed');
            const graph = runtime.variables.get('Graph') as GraphValue, add = graph.add;
            let calls = 0;
            graph.add = function (values) { calls++; add.call(this, values); };
            diagnostics.run(() => runtime.execute('for I in 1 to 3\n Graph add 1 I\nend'));
            expect(calls).toBe(3);
            expect(diagnostics.compiledGraphAdds).toBe(0);
            expect(graph.outgoingEdges(1n).map(edge => edge.target)).toEqual([1n, 2n, 3n]);
        } finally { runtime.dispose(); }
    });

    it('cancels effect regions cooperatively and runs finally without replay', () => {
        const runtime = new Interpreter(() => {}), diagnostics = new RuntimeDiagnostics();
        try {
            runtime.execute('use graph\nGraph = new graph .directed\nS = 0\nFinished = false');
            const graph = runtime.variables.get('Graph') as GraphValue;
            const signal = { length: 1, load: () => 0, store: () => {}, wait: () => {},
                exchange: () => graph.outgoingEdges(1n).length >= 10 ? 1 : 0 };
            expect(() => withInterrupt(signal, () => diagnostics.run(() => runtime.execute(`try
 for I in 1 to 10000
  Graph add 1 I
  S += 1
 end
finally
 Finished = true
end`)))).toThrow(InterruptedError);
            const targets = graph.outgoingEdges(1n).map(edge => edge.target);
            expect(targets.length).toBeGreaterThanOrEqual(10);
            expect(targets.length).toBeLessThan(10000);
            expect(targets).toEqual(Array.from({ length: targets.length }, (_, i) => BigInt(i + 1)));
            expect(runtime.variables.get('S')).toBe(BigInt(targets.length));
            expect(runtime.variables.get('Finished')).toBe(true);
            expect(diagnostics.compiledLoops).toBe(1);
        } finally { runtime.dispose(); }
    });

});
