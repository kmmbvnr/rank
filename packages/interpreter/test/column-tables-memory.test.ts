import v8 from 'node:v8';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { Interpreter, formatValue } from '../src/index.js';
import { MemoryIo } from './support.js';

v8.setFlagsFromString('--expose-gc');
const collect = vm.runInNewContext('gc') as () => void;

const ROWS = 100_000;

function titanicLike(rows: number): string {
    const lines = ['PassengerId,Survived,Pclass,Name,Sex,Age,SibSp,Parch,Ticket,Fare,Cabin,Embarked'];
    for (let i = 0; i < rows; i += 1) {
        lines.push([
            i + 1, i % 3 === 0 ? 1 : 0, i % 3 + 1, `"Person, Number ${i}"`, i % 3 ? 'male' : 'female',
            i % 11 ? 18 + i % 63 : '', i % 4, i % 3, `T${i % 700}`, i % 13 ? (5 + i % 200 / 4).toFixed(4) : '',
            i % 5 ? '' : `C${i % 90}`, 'SCQ'[i % 3],
        ].join(','));
    }
    return `${lines.join('\n')}\n`;
}

const used = () => process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;

/**
 * The reason column tables exist: a CSV table is a few buffers, not one object
 * per row. On this file the row-object table held about 125 MiB (see
 * benchmarks/arrow-csv.mjs); the bound leaves room for noise, not for a return
 * to per-row objects.
 */
describe('column table memory', () => {
    it('keeps a 100 000-row CSV table far below the row-object footprint', () => {
        const text = titanicLike(ROWS);
        const io = new MemoryIo({ '/big.csv': text });
        const runtime = new Interpreter(undefined, { io });
        runtime.execute('use tables\nuse stats');
        collect();
        const before = used();
        runtime.execute('Big = "/big.csv" csv');
        collect();
        const retained = used() - before;
        expect(formatValue(runtime.execute('Big len')!)).toBe(String(ROWS));
        expect(retained).toBeLessThan(30 * 1024 * 1024);
    });

    it('replaces a column without copying the others', () => {
        const io = new MemoryIo({ '/big.csv': titanicLike(ROWS) });
        const runtime = new Interpreter(undefined, { io });
        runtime.execute('use tables\nuse stats\nBig = "/big.csv" csv');
        collect();
        const before = used();
        runtime.execute('Other = Big\nOther .Fare = Other .Fare default 0.0');
        collect();
        // One new real column is 800 KB; copying the twelve columns would be several times that.
        expect(used() - before).toBeLessThan(8 * 1024 * 1024);
        expect(formatValue(runtime.execute('Big .PassengerId len')!)).toBe(String(ROWS));
    });
});
