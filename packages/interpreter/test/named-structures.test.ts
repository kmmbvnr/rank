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
tuple (A 1) (B 1) (S len) (T len) (C 7) (D 7) (Q len) (R len) (M len) (N len)
`)).toBe('10 20 1 0 1 0 1 0 1 0');
    });

    it('mutates aliases and parameters without copying the collections', () => {
        expect(run(`
use algo
use sequences
Seen = new set
Counts = new counter
Alias = Seen
fun visit S C X
  S add X
  C add X
  return 0
end
X = Seen Counts 7 visit
X = Alias Counts 7 visit
tuple (Seen len) (7 in Alias) (Counts 7)
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
tuple (Seen len) (Counts (array 1 2))
`)).toBe('1 2');
        expect(run('use algo\nSeen = new set\nSeen add 7\nSeen add 2\nSeen add 7\nResult = 0\nfor Value in Seen\n Result = Result * 10 + Value\nend\nResult')).toBe('72');
    });

    it('keeps one element type and array rank in sets and counters', () => {
        for (const kind of ['set', 'counter']) {
            expect(() => run(`use algo\nC = new ${kind}\nC add 1\nC add "text"`))
                .toThrow(`${kind} holds integer and cannot receive text`);
            expect(() => run(`use algo\nuse sequences\nC = new ${kind}\nC add array 1 2\nC add (array 1 2 3 4) reshape 2 2`))
                .toThrow(/rank 1.*rank 2/);
            expect(() => run(`use algo\nC = new ${kind}\nC add 1\nC remove 1\nC add "text"`))
                .toThrow(`${kind} holds integer and cannot receive text`);
            expect(() => run(`use algo\nuse sequences\nC = new ${kind}\nC add array 1 2\nC add array "a" "b"\nC len`))
                .toThrow(/array rank 1 of integer.*array rank 1 of text/);
        }
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
tuple First Second Other
`)).toBe('1 2 1');
    });

    it('keeps a function-local structure apart from a top-level one with the same name', () => {
        expect(run(`
use algo
use sequences
Queue = new queue
Queue push 9
Seen = new set
Seen add 9
Counts = new counter
Counts add 9
fun local N
  Queue = new queue
  Seen = new set
  Counts = new counter
  Before = array (Queue len) (Seen len) (Counts 9 default 0)
  Queue push N
  Seen add N
  Counts add N
  return Before
end
First = 1 local
Second = 2 local
tuple (First 0) (First 1) (First 2) (Second 0) (Queue len) (Seen len) (Counts 9)
`)).toBe('0 0 0 0 1 1 1');
    });

    it('allocates anew on repeated execution', () => {
        expect(run(`
use algo
use sequences
Seen = new set
Seen add 9
fun fresh N
  return new set
end
A = 0 fresh
B = 0 fresh
A add 1
tuple (A len) (B len) (Seen len)
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
tuple (Seen len) (Counts 7) (Tickets len) (Tickets floor 4)
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
            .toThrowError('remove expects a set, counter or multiset');
    });

    it('supports iteration, membership, removal and sorting for counters', () => {
        expect(run(`
use algo
use sequences
Counts = new counter
Counts add 7
Counts add 2
Counts add 7
Result = 0
for Key in Counts
  Result = Result * 10 + Key
end
HasSeven = 7 in Counts
HasThree = 3 in Counts
Counts remove 7
CountSeven = Counts 7
Counts remove 7
HasSevenAfter = 7 in Counts
Counts remove 2
EmptyLen = Counts len
tuple Result HasSeven HasThree CountSeven HasSevenAfter EmptyLen
`)).toBe('72 true false 1 false 0');

        expect(() => run('use algo\nC = new counter\nC remove 1'))
            .toThrowError('counter does not contain the value');

        expect(run(`
use algo
use sequences
C = new counter
C add "c"
C add "a"
C add "b"
M = C multiset
tuple (M 0) (M 1) (M 2)
`)).toBe('a b c');
    });

    it('creates fresh values in loops and keeps recursive function-local instances separate', () => {
        expect(run(`
use algo
use sequences
Sets = new queue
for I in 0 till 2
  Sets push new set
end
A = Sets 0
B = Sets 1
A add 1
fun down N
  Seen = new set
  Seen add N
  if N greater 0
    Child = (N - 1) down
  end
  return Seen len
end
tuple (A len) (B len) (10 down)
`)).toBe('1 0 1');
    });
});
