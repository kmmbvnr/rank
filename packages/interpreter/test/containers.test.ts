import { describe, expect, it } from 'vitest';
import { RankDeque, RankHeap } from '../src/containers.js';
import { MissingValueError } from '../src/errors.js';
import { run } from './support.js';

const prelude = 'use algo\nuse sequences\n';

describe('CP containers', () => {
    it('pops queues FIFO and stacks LIFO through shared references', () => {
        for (const [kind, expected] of [['queue', '1 1 2 0'], ['stack', '2 2 1 0']]) {
            expect(run(prelude + `
Q = new ${kind}
Q push 1
Q push 2
Alias = Q
fun take C
  return C pop
end
A = Q peek
B = Alias take
C = Q pop
array A B C (Q len)
`)).toBe(expected);
        }
    });

    it('keeps indexing, iteration and array operations consistent after queue pops', () => {
        expect(run(prelude + `
Q = new queue
Q push 9
Q push 2
Q push 3
X = Q pop
Sum = 0
for V in Q
  Sum += V
end
array (Q 0) (Q 1) (Q len) Sum (Q + reduce)
`)).toBe('2 3 2 5 5');
    });

    it('supports queue iteration that appends work for BFS', () => {
        expect(run(prelude + `
Q = new queue
Q push 0
for V in Q
  if V less 5
    Q push V + 1
  end
end
Q len
`)).toBe('6');
    });

    it('supports both deque ends and postfix mutations', () => {
        expect(run(prelude + `
D = new deque
D 2 pushback
D 1 pushfront
D 3 pushback
array (D peekfront) (D peekback) (D popfront) (D popback) (D pop) (D len)
`)).toBe('1 3 1 3 2 0');
    });

    it('uses a min heap and stable explicit priorities for arbitrary payloads', () => {
        expect(run(prelude + `
H = new heap
H push 9
H push -2
H push 4
array (H peek) (H pop) (H pop) (H pop) (H len)
`)).toBe('-2 -2 4 9 0');
        expect(run(prelude + `
H = new heap
H 4 "later" enqueue
H 1 "first" enqueue
H 1 "second" enqueue
array (H pop) (H pop) (H pop)
`)).toBe('first second later');
    });

    it('reports empty containers as missing values compatible with default', () => {
        for (const kind of ['queue', 'stack', 'deque', 'heap']) {
            expect(run(prelude + `C = new ${kind}\narray (C peek default -1) (C pop default -2) (C len)`)).toBe('-1 -2 0');
        }
        expect(() => new RankDeque().pop()).toThrow(MissingValueError);
        expect(() => new RankHeap().peek()).toThrow(MissingValueError);
    });

    it('runs shortest-path relaxation with separate priorities and vertex payloads', () => {
        expect(run(prelude + `
Graph = (array 0 7 1 0  0 0 0 1  0 2 0 9  0 0 0 0) (array 4 4) reshape
Dist = array 0 999 999 999
H = new heap
H 0 0 enqueue
for H len greater 0
  V = H pop
  for U in 0 until 4
    Weight = Graph V U
    if Weight greater 0
      Candidate = (Dist V) + Weight
      if Candidate less (Dist U)
        Dist U = Candidate
        H Candidate U enqueue
      end
    end
  end
end
Dist
`)).toBe('0 3 1 4');
    });

    it('compares huge integer priorities exactly and supports maximum priorities by negation', () => {
        const heap = new RankHeap();
        heap.push('large', 9007199254740993n);
        heap.push('small', 9007199254740992n);
        expect(heap.pop()).toBe('small');
        expect(heap.pop()).toBe('large');
        heap.push('one', -1n);
        heap.push('two', -2n);
        expect(heap.pop()).toBe('two');
    });

    it('provides inclusive and strict ordered bounds and an ordered unique variant', () => {
        for (const [kind, size] of [['multiset', 3], ['orderedset', 2]]) {
            expect(run(prelude + `
M = new ${kind}
M add 2
M add 2
M add 5
array (M len) (M lowerbound 2) (M upperbound 2) (M 3 lowerbound) (M upperbound 5 default -1)
`)).toBe(`${size} 2 5 5 -1`);
        }
    });

    it('matches reference models through mixed operations and reuse', () => {
        const deque = new RankDeque('deque');
        const heap = new RankHeap();
        const queueModel: bigint[] = [];
        const heapModel: bigint[] = [];
        let state = 12345;
        for (let i = 0; i < 5000; i++) {
            state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
            const value = BigInt(state % 101);
            if (state % 3 || !queueModel.length) {
                if (state % 2) { deque.push(value); queueModel.push(value); }
                else { deque.pushFront(value); queueModel.unshift(value); }
                heap.push(value); heapModel.push(value);
            } else {
                expect(deque.pop(Boolean(state % 2))).toBe(state % 2 ? queueModel.pop() : queueModel.shift());
                heapModel.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
                expect(heap.pop()).toBe(heapModel.shift());
            }
            expect(deque.size).toBe(queueModel.length);
        }
        expect(deque.items).toEqual(queueModel);
        heapModel.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
        expect(Array.from({ length: heap.size }, () => heap.pop())).toEqual(heapModel);
        heap.push('reused');
        expect(heap.pop()).toBe('reused');
    });

    it('handles 100000 entries without shifting or recursion', () => {
        const queue = new RankDeque();
        const heap = new RankHeap();
        for (let i = 100000; i > 0; i--) { queue.push(BigInt(i)); heap.push(BigInt(i)); }
        for (let i = 1; i <= 100000; i++) {
            if (queue.pop() !== BigInt(100001 - i) || heap.pop() !== BigInt(i)) throw new Error('order mismatch');
        }
        expect(queue.size).toBe(0);
        expect(heap.size).toBe(0);
    });

    it('rejects invalid receivers and priorities without changing heap contents', () => {
        expect(() => run(prelude + '1 pop')).toThrow('pop/peek expects');
        expect(() => run(prelude + 'D = new stack\nD popfront')).toThrow('expects a deque');
        const heap = new RankHeap().push(2n);
        expect(() => heap.push('bad')).toThrow('comparable type');
        expect(() => heap.push(NaN)).toThrow('NaN');
        expect(heap.size).toBe(1);
        expect(heap.pop()).toBe(2n);
    });
});


describe('queue iteration type summaries', () => {
    it('reuses an unchanged summary and keeps retained snapshots immutable', () => {
        const queue = new RankDeque();
        let calls = 0;
        const classify = (value: unknown) => { calls++; return typeof value; };
        queue.push(1n).push(2n);
        const first = queue.iterationTypes(classify);
        expect(queue.iterationTypes(classify)).toBe(first);
        expect(calls).toBe(2);
        queue.pushFront('text');
        expect(queue.iterationTypes(classify)).toEqual(new Set(['string', 'bigint']));
        expect(first).toEqual(new Set(['bigint']));
        queue.pop();
        expect(queue.iterationTypes(classify)).toEqual(new Set(['bigint']));
        queue.pop(true);
        queue.pop();
        expect(queue.iterationTypes(classify)).toEqual(new Set());
        queue.push(false);
        expect(queue.iterationTypes(classify)).toEqual(new Set(['boolean']));
    });

    it('checks newly inserted types before executing a reused loop', () => {
        expect(() => run(prelude + `
Q = new queue
Q push 1
for V in Q
  break
end
Alias = Q
Alias push "text"
for V in Q
  break
end
`)).toThrow(/cannot receive/);
    });

    it('does not retain removed types in later loop declarations', () => {
        expect(run(prelude + `
Q = new queue
Q push "text"
for Old in Q
  break
end
Removed = Q pop
Q push 7
V = 0
for V in Q
  break
end
V
`)).toBe('7');
    });
});
