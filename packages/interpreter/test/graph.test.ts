import { describe, expect, it } from 'vitest';
import { MissingValueError, RankError } from '../src/errors.js';
import { run } from './support.js';

const prelude = 'use graph\nuse sequences\n';

describe('graphs', () => {
    it('creates a closed undirected graph', () => {
        expect(run(prelude + `
use ranges
Nodes = 1 to 4
Graph = new graph Nodes .undirected
Graph add 1 2
Graph add 2 3
array (Graph len) ((Graph 2) array)
`)).toBe('4 1 3');
    });

    it('grows an open graph and keeps isolated vertices', () => {
        expect(run(prelude + `
Graph = new graph .undirected
Graph add "A" "B"
Graph add "alone"
array (Graph len) ((Graph "B") array)
`)).toBe('3 A');
    });

    it('adds rank-1 vertices and M by 2 edges', () => {
        expect(run(prelude + `
Graph = new graph .directed
Graph add (array 1 2 3 4)
Edges = array shape 3 2
  1 2
  1 3
  3 4
end
Graph add Edges
array ((Graph 1) array) ((Graph 3) array)
`)).toBe('2 3 4');
    });

    it('preserves parallel edges and one self neighbor', () => {
        expect(run(prelude + `
Graph = new graph .undirected
Graph add 1 2
Graph add 1 2
Graph add 1 1
(Graph 1) array
`)).toBe('2 2 1');
    });

    it('returns a finite lazy snapshot of neighbors', () => {
        expect(run(prelude + `
Graph = new graph .directed
Graph add 1 2
Neighbors = Graph 1
Graph add 1 3
array (Neighbors len) (Neighbors array)
`)).toBe('1 2');
    });

    it('rejects vertices outside a closed domain', () => {
        expect(() => run(prelude + `
Graph = new graph (array 1 2) .directed
Graph add 2 3
`)).toThrow(MissingValueError);
        expect(() => run(prelude + `
Graph = new graph (array 1 2) .directed
Graph 3
`)).toThrow(MissingValueError);
    });

    it('validates direction, shape and vertex types', () => {
        expect(() => run('use graph\nnew graph .sideways'))
            .toThrow('new graph expects .directed or .undirected');
        expect(() => run(prelude + `
Graph = new graph .directed
Graph add (array shape 2 3 pad 0)
`)).toThrow('graph edge array must have shape M by 2');
        expect(() => run(prelude + `
Graph = new graph .directed
Graph add (array shape 1 1 1 pad 0)
`)).toThrow(RankError);
    });

    it('requires use graph and does not reserve add', () => {
        expect(() => run('new graph .directed'))
            .toThrow('new graph requires: use graph');
        expect(run(`
fun add A B
  return A + B
end
3 4 add
`)).toBe('7');
    });
});
