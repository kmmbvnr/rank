import { describe, expect, it } from 'vitest';
import { Interpreter } from '../src/index.js';
import { run } from './support.js';

describe('named structures', () => {
    it('uses real scalar index keys', () => {
        expect(run(`
use algo
Values = new index
Values 1.5 = "half"
Values 1.5
`)).toBe('half');
    });

    it('creates independent instances of all five explicit structure types', () => {
        expect(run(`
use algo
use sequences
A = new index
B = new index
A 1 = 10
B 1 = 20
S = new set
T = new set
S add 7
C = new counter
D = new counter
C add 7
Q = new queue
R = new queue
Q push 7
M = new multiset
N = new multiset
M add 7
array (A 1) (B 1) (S len) (T len) (C 7) (D 7) (Q len) (R len) (M len) (N len)
`)).toBe('10 20 1 0 1 0 1 0 1 0');
    });

    it('mutates aliases and parameters without copying the collections', () => {
        expect(run(`
use algo
use sequences
Seen = set
Counts = counter
Alias = Seen
fun visit S C X
  S add X
  C add X
  return 0
end
X = Seen Counts 7 visit
X = Alias Counts 7 visit
array (Seen len) (7 in Alias) (Counts 7)
`)).toBe('1 true 2');
    });

    it('takes the full add expression and evaluates its value once', () => {
        const output: string[] = [];
        const interpreter = new Interpreter(line => output.push(line));
        expect(interpreter.execute(`
use algo
use io
Counts = new counter
fun value N
  N print
  return N
end
Counts add (5 value) + 2
Counts 7
`)).toBe(1n);
        expect(output).toEqual(['5']);
    });

    it('preserves structural keys and insertion order for named sets and counters', () => {
        expect(run(`
use algo
use sequences
Seen = new set
Counts = new counter
Seen add array 1 2
Seen add array 1 2
Counts add array 1 2
Counts add array 1 2
array (Seen len) (Counts (array 1 2))
`)).toBe('1 2');
        expect(run('use algo\nSeen = new set\nSeen add 7\nSeen add 2\nSeen add 7\nResult = 0\nfor Value in Seen\n Result = Result * 10 + Value\nend\nResult')).toBe('72');
    });

    it('captures named structures in returned local functions', () => {
        expect(run(`
use algo
fun make N
  Counts = new counter
  return count
  fun count X
    Counts add X
    return Counts X
  end
end
A = 0 make
B = 0 make
First = 7 A
Second = 7 A
Other = 7 B
array First Second Other
`)).toBe('1 2 1');
    });

    it('does not inherit outer implicit queues, sets or counters', () => {
        expect(run(`
use algo
use sequences
queue push 9
set add 9
counter add 9
fun local N
  Before = array (queue len) (set len) (counter 9)
  queue push N
  set add N
  counter add N
  return Before
end
First = 1 local
Second = 2 local
array (First 0) (First 1) (First 2) (Second 0) (queue len) (set len) (counter 9)
`)).toBe('0 0 0 0 1 1 1');
    });

    it('allocates anew on repeated execution and does not replace the implicit structure', () => {
        expect(run(`
use algo
use sequences
set add 9
fun fresh N
  return new set
end
A = 0 fresh
B = 0 fresh
A add 1
array (A len) (B len) (set len)
`)).toBe('1 0 1');
    });

    it('keeps postfix add and multiset methods working', () => {
        expect(run(`
use algo
use sequences
Seen = new set
X = Seen 7 add
Counts = new counter
Y = Counts 7 add
Tickets = (array 3 3) multiset
Tickets add 4
Tickets remove 3
array (Seen len) (Counts 7) (Tickets len) (Tickets floor 4)
`)).toBe('1 1 2 4');
        expect(run('fun add A B\n return A + B\nend\n3 4 add')).toBe('7');
    });

    it('removes set values through either application order', () => {
        expect(run(`
use algo
use sequences
Seen = new set
Seen add 2
Seen add 7
Seen remove 2
Seen 7 remove
Seen len
`)).toBe('0');
        expect(() => run('use algo\nSeen = new set\nSeen remove 1'))
            .toThrowError('set does not contain the value');
    });

    it('reports unsupported constructors and receiver types as Rank errors', () => {
        expect(() => run('new set')).toThrowError('requires: use algo');
        expect(() => run('use algo\nnew unknown')).toThrowError('unknown structure');
        expect(() => run('use algo\nA = array 1 2\nA add 3')).toThrowError('add expects a graph, set, counter or multiset');
        expect(() => run('use algo\nA = array 1 2\nA remove 1'))
            .toThrowError('remove expects a set or multiset');
    });

    it('creates fresh values in loops and keeps recursive implicit instances separate', () => {
        expect(run(`
use algo
use ranges
use sequences
Sets = new queue
for I in 0 until 2
  Sets push new set
end
A = Sets 0
B = Sets 1
A add 1
fun down N
  set add N
  if N greater 0
    Child = (N - 1) down
  end
  return set len
end
array (A len) (B len) (10 down)
`)).toBe('1 0 1');
    });
});
