import { describe, expect, it } from 'vitest';
import { run } from './support.js';

const SEQ = 'use sequences\n';
const ALGO = 'use sequences\nuse algo\n';

// Arrays are values. A name holds its own value, and a write through one name
// is never visible through another. Reference semantics stays with the few
// identity-bearing structures that document it: records, graphs and the
// `algo` containers.
describe('value semantics for arrays', () => {
    it('gives an assigned name its own value', () => {
        expect(run(`${SEQ}A = array 1 2 3\nB = A\nB 0 = 99\nA`)).toBe('1 2 3');
        expect(run(`${SEQ}A = array 1 2 3\nB = A\nB 0 = 99\nB`)).toBe('99 2 3');
        expect(run(`${SEQ}A = array 1 2 3\nB = A\nB 0 += 5\nA`)).toBe('1 2 3');
        expect(run(`${SEQ}I = 0\nA = array 1 2\nB = A\nB I = 9\nA`)).toBe('1 2');
    });

    it('keeps writing in place after the first private copy', () => {
        expect(run(`${SEQ}A = array 1 2 3\nB = A\nB 0 = 9\nB 1 = 8\nB 2 = 7\nB`))
            .toBe('9 8 7');
        expect(run(`${SEQ}A = array 1 2 3\nB = A\nB 0 = 9\nB 1 = 8\nA`)).toBe('1 2 3');
    });

    it('keeps branch-selected aliases separate after a write', () => {
        const source = `${SEQ}A = array 1 2\nC = array 3 4 5\n`;
        for (const condition of ['true', 'false']) {
            const branch = `B = C\nif ${condition}\n B = A\nelse\n B = C\nend\nB 0 = 9\n`;
            expect(run(`${source}${branch}A`)).toBe('1 2');
            expect(run(`${source}${branch}C`)).toBe('3 4 5');
        }
    });

    it('does not let a function change its caller', () => {
        const bump = `${SEQ}fun bump V\n  V 0 = 99\n  return V\nend\nA = array 1 2 3\n`;
        expect(run(`${bump}C = A bump\nA`)).toBe('1 2 3');
        expect(run(`${bump}C = A bump\nC`)).toBe('99 2 3');
    });

    it('keeps top-level function assignments local and allows nested captures', () => {
        const local = `${SEQ}A = array 1 2\nfun change\n A = array 1 2 3\n return 0\nend\nchange\n`;
        expect(run(`${local}A`)).toBe('1 2');
        const captured = `${SEQ}fun outer\n A = array 1 2\n B = A\n fun change\n  A = array 1 2 3\n  return 0\n end\n change\n return A\nend\n`;
        expect(run(`${captured}outer`)).toBe('1 2 3');
        const second = `${SEQ}fun outer\n Y = array 1 2\n Z = array 3 4\n fun change\n  Z = array 5 6 7\n  return 0\n end\n change\n return Z\nend\n`;
        expect(run(`${second}outer`)).toBe('5 6 7');
        expect(run(`${second.replace('return Z', 'return Y')}outer`)).toBe('1 2');
        const grandchild = `${SEQ}fun outer\n Z = array 1 2\n Y = array 3 4\n fun middle\n  fun change\n   Z = array 5 6 7\n   return 0\n  end\n  change\n  return 0\n end\n middle\n return Z\nend\n`;
        expect(run(`${grandchild}outer`)).toBe('5 6 7');
        expect(run(`${grandchild.replace('return Z', 'return Y')}outer`)).toBe('3 4');
    });

    it('returns a privately written array without changing an equal-named global', () => {
        const source = `${SEQ}Temp = array 4 5\nfun build\n Temp = array 1 2\n Temp 0 = 9\n return Temp\nend\nResult = build\n`;
        expect(run(source + 'Result')).toBe('9 2');
        expect(run(source + 'Temp')).toBe('4 5');
    });

    it('reads a global capture despite an equally named caller parameter', () => {
        expect(run(`${SEQ}Shared = array 1 2\nfun read\n return Shared 0\nend\n`
            + 'fun outer Shared\n return read\nend\n(array 3 4) outer')).toBe('1');
        expect(run('Offset = 1\nfun read Ignored\n return Offset\nend\n'
            + 'fun outer Offset\n return 1 read\nend\n"x" outer')).toBe('1');
    });

    it('writes the global capture, not an equally named caller parameter', () => {
        const source = `${SEQ}Shared = array 1 2\nOther = array 3 4\n`
            + 'fun write Value\n Shared 0 = Value\n return 0\nend\n'
            + 'fun outer Shared\n 9 write\n return Shared 0\nend\nOther outer\n';
        expect(run(source + 'Shared 0')).toBe('9');
        expect(run(source + 'Other 0')).toBe('3');
    });

    it('lets a direct nested helper read and write its parent argument', () => {
        const reader = `${SEQ}fun outer X\n fun read\n  return X 0\n end\n return read\nend\nA = array 1 2\n`;
        expect(run(reader + 'A outer')).toBe('1');
        const writer = `${SEQ}fun outer X\n fun change\n  X 0 = 9\n  return 0\n end\n change\n return X 0\nend\nA = array 1 2\n`;
        expect(run(writer + 'A outer')).toBe('9');
        expect(run(writer + 'Ignored = A outer\nA 0')).toBe('1');
    });

    it('reads a private eager array through two lexical helper frames', () => {
        expect(run(`${SEQ}fun outer N\n Temp = array 1 2\n fun middle\n  fun read\n   return Temp 0\n  end\n  return read\n end\n return middle\nend\n0 outer`)).toBe('1');
    });

    it('separates each argument from the others', () => {
        expect(run(`${SEQ}fun both X Y\n  X 0 = 7\n  return Y 0\nend\n`
            + 'A = array 1 2\nR = A A both\nA')).toBe('1 2');
    });

    it('gives a stored value to a record, a queue and an index', () => {
        expect(run(`${SEQ}A = array 1 2\nR = record\n  .v = A\nend\nA 0 = 9\nR .v`))
            .toBe('1 2');
        expect(run(`${ALGO}A = array 1 2\nQ = queue\nQ push A\nA 0 = 9\nQ pop`))
            .toBe('1 2');
        expect(run(`${ALGO}A = array 1 2\nindex 1 = A\nA 0 = 9\nindex 1`))
            .toBe('1 2');
    });

    it('stores the value a generator yielded, not its buffer', () => {
        const src = `${ALGO}fun src\n  Pos = array 1 1\n  for # in 1 to 3\n`
            + '    Pos 0 += 1\n    yield Pos\n  end\nend\n';
        expect(run(`${src}S = set\nfor P in src\n  S add P\nend\nS len`)).toBe('3');
        expect(run(`${src}Seen = set\nfor P in src\n  Seen add P\nend\n`
            + 'Total = 0\nfor V in Seen\n  Total += V 0\nend\nTotal')).toBe('9');
        expect(run(`${src}Q = queue\nfor P in src\n  Q push P\nend\nQ pop`)).toBe('2 1');
    });

    it('leaves a loop row and the array it came from independent', () => {
        expect(run(`${SEQ}M = array shape 2 2\n  1 2\n  3 4\nend\n`
            + 'for V in M\n  V 0 = 9\nend\nM')).toBe('1 2 3 4');
    });

    it('freezes a derived array against later writes to its source', () => {
        expect(run(`${SEQ}A = array 1 2\nB = A * 2\nA 0 = 5\nB`)).toBe('2 4');
        expect(run(`${SEQ}A = array 1 2\nB = A * 2\nA 0 = 5\nA`)).toBe('5 2');
        expect(run(`${SEQ}A = array 1 2\nB = A copy\nA 0 = 5\nB`)).toBe('1 2');
    });

    it('still writes an unshared array in place', () => {
        expect(run(`${SEQ}A = array 0 0 0\nfor I in 0 to 2\n  A I = I * I\nend\nA`))
            .toBe('0 1 4');
        expect(run(`${SEQ}A = array 1 2 3\nTotal = (A * 2) sum\nA 0 = 9\nA`))
            .toBe('9 2 3');
    });
});

// The reference types keep their documented identity. They are the deliberate
// exception, and the set of them is closed.
describe('reference values that stay shared', () => {
    it('shares a record through every binding', () => {
        expect(run('R = record\n  .n = 1\nend\nS = R\nS .n = 9\nR .n')).toBe('9');
        expect(run('fun bump N\n  N .n = 9\n  return N .n\nend\nR = record\n  .n = 1\nend\n'
            + 'Seen = R bump\nR .n')).toBe('9');
    });

    // Table rows are objects, so two names for one table share its rows.
    it('shares the rows of a table through every binding', () => {
        const table = 'use json\nuse tables\nuse sequences\nT = "[{\\"a\\":1},{\\"a\\":3}]" json\n';
        expect(run(`${table}U = T\nU .a = 9\nT .a`)).toBe('9 9');
        // `copy` forces the table's own storage; `select` builds new rows.
        expect(run(`${table}U = T copy\nU .a = 9\nT .a`)).toBe('9 9');
        expect(run(`${table}U = T select .a\nU .a = 9\nT .a`)).toBe('1 3');
    });

    it('shares an algo container through every binding', () => {
        expect(run('use algo\nA = set\nB = A\nB add 1\nA len')).toBe('1');
    });
});

// A lazy reader may stand on further readers. Retaining the last one retains
// the whole chain, so no write to any source can change what it reports.
describe('a retained lazy chain', () => {
    it('freezes every source it reads through', () => {
        expect(run(`${SEQ}A = array 1 2 3\nB = (A 2 window) * 2\nA 1 = 5\nB`))
            .toBe('2 4 4 6');
        expect(run(`${SEQ}A = array 1 2 3\nW = A 2 window\nB = W * 2\nA 1 = 5\nB`))
            .toBe('2 4 4 6');
    });
});
