// Research installers only. Never imported by the interpreter.
import assert from 'node:assert/strict';
import { cpSync, readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';

function replace(s, a, b) {
    assert.equal(s.split(a).length, 2, `Expected one anchor: ${a.slice(0,90)}`);
    return s.replace(a, b);
}
function edit(dir, file, fn) {
    const path = resolve(dir, file);
    writeFileSync(path, fn(readFileSync(path, 'utf8')));
}
const cellsSource = `
export class ReadCells {
    constructor(source) { this.source = source; this.length = source.length; }
    get(i) { return this.source[i]; }
}
export class JournalCells {
    constructor(source, safe, type, d) {
        this.source = source; this.length = source.length;
        this.safe = safe; this.type = type; this.d = d; this.pages = new Map();
    }
    get(i) {
        if (this.pages.has(i)) return this.pages.get(i);
        const v = Number(this.source[i]); return this.type === 'integer' ? this.safe(v) : v;
    }
    set(i, v) {
        if (this.d && !this.pages.has(i)) this.d.cost('experimental.journal').calls++;
        this.pages.set(i, v);
    }
    publish(write) { for (const [i,v] of this.pages) write(i,v); }
}
export class SparseCells {
    constructor(source, safe, type, diagnostics, pageSize) {
        this.source = source; this.length = source.length;
        this.safe = safe; this.type = type; this.d = diagnostics;
        this.pageSize = pageSize; this.pages = new Map();
    }
    checked(v) { v = Number(v); return this.type === 'integer' ? this.safe(v) : v; }
    get(i) {
        const n = Math.floor(i / this.pageSize), p = this.pages.get(n);
        return p ? p.values[i % this.pageSize] : this.checked(this.source[i]);
    }
    set(i, v) {
        const n = Math.floor(i / this.pageSize); let p = this.pages.get(n);
        if (!p) {
            const first = n * this.pageSize;
            const count = Math.min(this.pageSize, this.length - first);
            const values = new Float64Array(count);
            for (let j = 0; j < count; j++) values[j] = this.checked(this.source[first + j]);
            p = { values, dirty: new Uint8Array(count) }; this.pages.set(n, p);
            if (this.d) {
                const c = this.d.cost('experimental.sparse');
                c.calls++; c.allocatedBytes += count * 9; c.copiedBytes += count * 8;
            }
        }
        p.values[i % this.pageSize] = v; p.dirty[i % this.pageSize] = 1;
    }
    publish(write) {
        for (const [n, p] of this.pages)
            for (let j = 0; j < p.values.length; j++)
                if (p.dirty[j]) write(n * this.pageSize + j, p.values[j]);
    }
}
`;

function sparse(dir, pageSize) {
    cpSync(resolve(dir, 'jit/number-loop-runtime.js'), resolve(dir, 'jit/ordinary-number-loop-runtime.js'));
    writeFileSync(resolve(dir, 'jit/experimental-cells.js'), cellsSource);
    edit(dir, 'jit/number-loop-runtime.js', s => {
        s = `import { prepareNumberLoop as prepareOrdinary } from './ordinary-number-loop-runtime.js';\nimport { ReadCells, SparseCells, JournalCells } from './experimental-cells.js';\n` + s;
        s = replace(s, '    const reboundInputs =', `    const ordinary = prepareOrdinary(plan, host, feedback, compileCountedPlan, compilePollingPlan);
    // Only scalar indexed operations have an audited sparse accessor ABI.
    if (plan.vectorIterations.length || plan.arrayDefinitions.size || plan.calls.length
        || plan.callouts?.length || plan.containers.size || plan.hasReturn || plan.hasYield
        || plan.numberVectors || plan.sliceReadSources.size
        || /copyArray|concatArrays|sliceArray|sliceResult|vectorArray|rangeArray|compactVector/.test(plan.body.join('')))
        return ordinary;
    const reboundInputs =`);
        s = replace(s, '    return { run: (...context) => {', '    return { run: (...context) => {\n            if (interruptsEnabled()) return ordinary?.run(...context);');
        s = replace(s, 'const probe = conditionWriteCells > SMALL_COPY_CELLS;', 'const probe = false; // Experimental: actual touched pages pay for storage.');
        s = replace(s, '    const compile = (code) => new Function(', `    const compile = (code) => {
        code = code.replace(/cells(\\d+)\\[([^\\]]+)\\] = ([^;]+);/g, 'cells$1.set($2, $3);')
            .replace(/cells(\\d+)\\[([^\\]]+)\\]/g, 'cells$1.get($2)')
            .replace(/changed\\d+\\[[^\\]]+\\] = 1;/g, '');
        return new Function(`);
        s = replace(s, '() => !interruptsEnabled());', '() => !interruptsEnabled());\n    };');
        s = replace(s, '            // A single indexed read-only pass', `            if (plan.destinations.has(name)) {
                buffers[info.slot] = new ${pageSize === 1 ? 'JournalCells' : 'SparseCells'}(info.type === 'integer' ? (integer32Cells(value) ?? items) : items,
                    safe, info.type, currentDiagnostics(), ${pageSize});
                sources[info.slot] = value; input[info.slot] = value;
                // Generated dirty writes are unused by sparse publication.
                changes[info.slot] = {};
                continue;
            }
            // A single indexed read-only pass`);
        s = replace(s, '        if (diagnostics)\n            diagnostics.numberLoops++;', `        for (const [name, info] of storage)
            if (!plan.destinations.has(name)) buffers[info.slot] = new ReadCells(buffers[info.slot]);
        if (diagnostics) diagnostics.numberLoops++;`);
        s = replace(s, '                    const dirty = changes[info.slot];', `                    const sparse = buffers[info.slot];
                    if (sparse instanceof SparseCells || sparse instanceof JournalCells) {
                        if (!sparse.pages.size) continue;
                        const source = sources[info.slot], copy = arrayForWrite(source);
                        if (copy !== undefined) host.writer(name)(copy);
                        const write = prepareScalarArrayWriter(borrowArrayStorage(copy ?? source), true);
                        sparse.publish((i, v) => write(i, info.type === 'boolean' ? Boolean(v) : info.type === 'real' ? v : BigInt(v)));
                        continue;
                    }
                    const dirty = changes[info.slot];`);
        return s;
    });
}

function checkpoint(dir, chunk) {
    edit(dir, 'jit/integer-loop.js', s => {
        s = `import { privateLoopPolling, demandBudgetEnabled, interruptsEnabled } from '../interrupt.js';\n` + s;
        s = replace(s, 'numberVariant && (region?.destinations.size || copiesTrees)', 'numberVariant && region');
        s = replace(s, '? { cells: 0, allow: true } : undefined;', `? { cells: 0, allow: true, transfer: { active: false, paused: false, previous: undefined, chunk: ${chunk} } } : undefined;`);
        const start = s.indexOf('    return { run: (...context) => {', s.indexOf('function compileTypedLoop'));
        const end = s.indexOf('\n}\n/** Shared region checks', start);
        assert(start > 0 && end > start);
        const ordinary = s.slice(start, end).replace('    return { run:', '    const ordinary = { run:');
        return s.slice(0, start) + ordinary + `
    const eligible = feedback && plan && !iteration && !plan.hasControl && !plan.hasReturn
        && !plan.hasYield && !plan.calls.length && !plan.callouts?.length && !plan.containers.size
        && !plan.vectorIterations.length && !plan.arrayDefinitions.size && !plan.wideScalars.size;
    return { run: (...context) => {
        if (!eligible || !privateLoopPolling() || interruptsEnabled() || host.observableEntry) return ordinary.run(...context);
        const t = feedback.transfer;
        // The historical transfer prototype's conservative copy ceiling.
        let cells = 0;
        for (const [name] of plan.destinations) {
            const a = host.read(name);
            if (!a || !isRankArray(a)) return ordinary.run(...context);
            cells += a.shape.reduce((a,b) => a*b, 1);
        }
        if (cells > 262144) return ordinary.run(...context);
        t.active = true; t.previous = undefined;
        try {
            let result;
            do { t.paused = false; result = ordinary.run(...context); } while (result && t.paused);
            return result;
        } finally { t.active = false; t.paused = false; t.previous = undefined; }
    }};` + s.slice(end);
    });
    edit(dir, 'jit/number-loop-runtime.js', s => {
        s = replace(s, '    const compile = (code) => new Function(', `    const compile = (code) => {
        if (feedback?.transfer) code = code
            .replace("result, resultType = 'integer'", "result = transfer.active ? transfer.previous : undefined, resultType = transfer.active && typeof transfer.previous === 'boolean' ? 'boolean' : transfer.active && typeof transfer.previous === 'number' ? 'real' : 'integer'")
            .replace('const entered = [];', 'const entered = []; let steps = 0;')
            .replace("let iterationResult, iterationType = 'integer';", "if(transfer.active && steps++ >= transfer.chunk) { transfer.paused = true; break; } let iterationResult, iterationType = 'integer';");
        return new Function(`);
        s = replace(s, "'streamScatterEnabled', code)", "'streamScatterEnabled', 'transfer', code)");
        s = replace(s, '() => !interruptsEnabled());', '() => !interruptsEnabled(), feedback?.transfer);\n    };');
        s = replace(s, 'const probe = conditionWriteCells > SMALL_COPY_CELLS;', 'const probe = conditionWriteCells > SMALL_COPY_CELLS && !feedback?.transfer?.active;');
        s = replace(s, '        return completed(rankValue(result.value, result.type));', `        if (feedback?.transfer?.active) {
            feedback.transfer.previous = rankValue(result.value, result.type);
            if (diagnostics) diagnostics.cost('experimental.chunks').calls++;
        }
        return completed(rankValue(result.value, result.type));`);
        return s;
    });
    edit(dir, 'jit/integer-loop-runtime.js', s => {
        s = replace(s, '    let countedRun;', '    let countedRun, transferRun;');
        s = replace(s, '        let runner = run;', `        let runner = run;
        if (feedback?.transfer?.active) {
            transferRun ??= compile(source.replace('let result = initialResult,', 'let result = observeWork.transfer.previous,'),
                Object.assign(() => {}, { transfer: feedback.transfer }));
            runner = transferRun;
        }`);
        s = replace(s, 'if (feedback?.cells && privateLoopPolling() && !hasYield)', 'if (!feedback?.transfer?.active && feedback?.cells && privateLoopPolling() && !hasYield)');
        return s;
    });
}

export function prepare(root, out, chunk = 8192) {
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, 'package.json'), '{"type":"module"}\n');
    if (!existsSync(resolve(out, 'node_modules'))) symlinkSync(resolve(root, 'node_modules'), resolve(out, 'node_modules'));
    for (const variant of ['current', 'pages', 'journal', 'checkpoint']) {
        const dir = resolve(out, variant);
        cpSync(resolve(root, 'packages/interpreter/out'), dir, { recursive: true });
        if (variant === 'pages' || variant === 'journal') sparse(dir, variant === 'pages' ? 512 : 1);
        if (variant === 'checkpoint') checkpoint(dir, chunk);
        edit(dir, 'jit/number-loop-runtime.js', s => {
            const helper = `
function instrumentStorage(code) {
    const d = currentDiagnostics();
    if (!d) return code;
    return code.replace('const entered = [];', 'const entered = []; let diagnosticIterations = 0;')
        .replace("let iterationResult, iterationType = 'integer';", "diagnosticIterations++; let iterationResult, iterationType = 'integer';")
        .replace('if (error === overflow) return undefined;', 'if (error === overflow) { storageDiagnostics.discardedRootIterations = (storageDiagnostics.discardedRootIterations ?? 0) + diagnosticIterations; return undefined; }');
}
`;
            s = helper + s;
            const end = variant === 'checkpoint' ? "'transfer', code)" : "'streamScatterEnabled', code)";
            s = replace(s, end, end.replace('code)', "'storageDiagnostics', instrumentStorage(code))"));
            const args = variant === 'checkpoint' ? 'feedback?.transfer);' : '() => !interruptsEnabled());';
            s = replace(s, args, args.slice(0,-2) + ', currentDiagnostics());');
            return s;
        });

    }
}
