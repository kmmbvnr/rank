import { describe, expect, it } from 'vitest';
import { Interpreter, RankError, formatValue, isRankSequence } from '../src/index.js';
import { sequence, takeDropValue, windowValue } from '../src/sequence.js';
import { materializeValue } from '../src/materialize.js';
import { MemoryIo, TokenInput } from './support.js';

const generator = `use io
fun N values
  "started" print
  for I in 1 to N
    yield I
  end
end`;

describe.each([false, true])('single-pass bindings (compilation=%s)', compilation => {
    it('keeps one generator instance and requires a new call for a new pass', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute(`${generator}\nStream' = 3 values\nTotal' = Stream sum`);
            expect(output).toEqual([]);
            expect(isRankSequence(runtime.variables.get('Stream')!)).toBe(true);
            expect(runtime.execute('Total')).toBe(6n);
            expect(output).toEqual(['started']);
            expect(() => runtime.execute('Total')).toThrowError(expect.objectContaining({ rankKind: 'ConsumedSequence' }));
            expect(output).toEqual(['started']);
            expect(runtime.execute('3 values sum')).toBe(6n);
            expect(output).toEqual(['started', 'started']);
        } finally { runtime.dispose(); }
    });

    it('stores an ordinary generator result once for several consumers', () => {
        const output: string[] = [];
        const runtime = new Interpreter(text => output.push(text), { compilation });
        try {
            runtime.execute(`${generator}\nSaved = 3 values`);
            expect(runtime.variables.get('Saved')).toMatchObject({ kind: 'array', shape: [3] });
            expect(output).toEqual(['started']);
            expect(runtime.execute('Saved sum')).toBe(6n);
            expect(runtime.execute('Saved sum')).toBe(6n);
            expect(output).toEqual(['started']);
        } finally { runtime.dispose(); }
    });

    it('captures a counted input stream without reading it or restarting it', () => {
        const input = new TokenInput(['10', '20', 'tail']);
        const runtime = new Interpreter(undefined, { compilation, input });
        try {
            runtime.execute("use io\nCount = 2\nStream' = stdin .integer Count\nTotal' = Stream sum\nCount = 1");
            expect(input.reads).toBe(0);
            expect(runtime.variables.get('Stream')).toMatchObject({ kind: 'sequence', plan: {
                singlePass: true, size: { kind: 'exact', value: 2n },
            } });
            expect(runtime.execute('Total')).toBe(30n);
            expect(input.reads).toBe(2);
            expect(() => runtime.execute('Total')).toThrowError(expect.objectContaining({ rankKind: 'ConsumedSequence' }));
            expect(input.reads).toBe(2);
            expect(runtime.execute('stdin .word')).toBe('tail');
        } finally { runtime.dispose(); }
    });

    it('keeps an inline input stream in a scalar recipe instead of reading another batch', () => {
        const input = new TokenInput(['2', '3', '7', '11']);
        const runtime = new Interpreter(undefined, { compilation, input });
        try {
            runtime.execute("use io\nTotal' = (stdin .integer 2) sum");
            expect(input.reads).toBe(0);
            expect(runtime.execute('Total')).toBe(5n);
            expect(() => runtime.execute('Total')).toThrowError(expect.objectContaining({ rankKind: 'ConsumedSequence' }));
            expect(input.reads).toBe(2);
            expect(runtime.execute('Saved = stdin .integer 2')).toMatchObject({ kind: 'array', shape: [2] });
            expect(runtime.execute('Saved sum')).toBe(18n);
            expect(runtime.execute('Saved sum')).toBe(18n);
            expect(input.reads).toBe(4);
        } finally { runtime.dispose(); }
    });

    it('replays an explicit scalar read effect without treating it as a stored stream', () => {
        const input = new TokenInput(['2', '3']);
        const runtime = new Interpreter(undefined, { compilation, input });
        try {
            runtime.execute("use io\nRead' = stdin .integer");
            expect(input.reads).toBe(0);
            expect(runtime.execute('Read')).toBe(2n);
            expect(runtime.execute('Read')).toBe(3n);
            expect(input.reads).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('leaves a failed input stream consumed and publishes no partial binding', () => {
        const input = new TokenInput(['1', 'bad', '3']);
        const runtime = new Interpreter(undefined, { compilation, input });
        try {
            runtime.execute("use io\nStream' = stdin .integer 3\nSaved = array 9");
            expect(() => runtime.execute('Saved = Stream')).toThrowError(expect.objectContaining({ rankKind: 'InvalidNumber' }));
            expect(formatValue(runtime.variables.get('Saved')!)).toBe('9');
            expect(input.reads).toBe(2);
            expect(() => runtime.execute('Saved = Stream')).toThrowError(expect.objectContaining({ rankKind: 'ConsumedSequence' }));
            expect(input.reads).toBe(2);
        } finally { runtime.dispose(); }
    });

    it('does not buffer a single-pass source to make windows replayable', () => {
        const input = new TokenInput(['1', '2', '3', '4', 'tail']);
        const runtime = new Interpreter(undefined, { compilation, input });
        try {
            runtime.execute("use io\nuse sequences\nWindows' = (stdin .integer 4) window 2\nSaved = Windows");
            expect(runtime.variables.get('Saved')).toMatchObject({ kind: 'array', shape: [3, 2] });
            expect(formatValue(runtime.variables.get('Saved')!)).toBe('1 2 2 3 3 4');
            expect(input.reads).toBe(4);
            expect(() => runtime.execute('Again = Windows')).toThrowError(expect.objectContaining({ rankKind: 'ConsumedSequence' }));
            expect(input.reads).toBe(4);
            expect(runtime.execute('stdin .word')).toBe('tail');
        } finally { runtime.dispose(); }
    });

    it('does not reopen resources after a prefix closes its generator', () => {
        const io = new MemoryIo({ '/input': 'Rank' });
        const runtime = new Interpreter(undefined, { compilation, io });
        try {
            runtime.execute(`use io
fun Path positions
  File = Path open
  yield File position
  yield File size
end
Stream' = "/input" positions
Prefix' = Stream take 1`);
            expect(io.handles).toHaveLength(0);
            expect(formatValue(runtime.execute('Saved = Prefix')!)).toBe('0');
            expect(io.handles).toHaveLength(1);
            expect(io.handles[0].closed).toBe(true);
            expect(() => runtime.execute('Again = Prefix')).toThrowError(expect.objectContaining({ rankKind: 'ConsumedSequence' }));
            expect(io.handles).toHaveLength(1);
        } finally { runtime.dispose(); }
    });

    it('materializes a stream on eager parameter entry and preserves it on deferred entry', () => {
        const runtime = new Interpreter(() => {}, { compilation });
        try {
            runtime.execute(`${generator}
fun X twice = (X sum) + (X sum)
fun X' twice_stream = (X sum) + (X sum)`);
            expect(runtime.execute('3 values twice')).toBe(12n);
            expect(() => runtime.execute('3 values twice_stream')).toThrowError(expect.objectContaining({ rankKind: 'ConsumedSequence' }));
        } finally { runtime.dispose(); }
    });
});

it('closes an exact-size native stream when a window consumer stops early', () => {
    let consumed = false;
    let reads = 0;
    let closed = 0;
    const source = sequence({ name: 'native resource', singlePass: true, size: { kind: 'exact', value: 4n },
        *iterate() {
            if (consumed) throw new RankError('already consumed', 'ConsumedSequence');
            consumed = true;
            try { for (let value = 1n; value <= 4n; value++) { reads++; yield value; } }
            finally { closed++; }
        },
    });
    const windows = windowValue(source, 2n);
    expect(windows).toMatchObject({ kind: 'sequence', plan: { singlePass: true, size: { kind: 'exact', value: 3n } } });
    expect(formatValue(materializeValue(takeDropValue(windows, 1n)))).toBe('1 2');
    expect(reads).toBe(2);
    expect(closed).toBe(1);
    expect(() => materializeValue(windows)).toThrowError(expect.objectContaining({ rankKind: 'ConsumedSequence' }));
    expect(reads).toBe(2);
});
