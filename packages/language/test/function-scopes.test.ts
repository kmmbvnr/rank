import { EmptyFileSystem } from 'langium';
import { describe, expect, it } from 'vitest';
import { analyzeFunctionScopes, functionScopeDiagnostics, expressionDiagnostics, functionMutationDiagnostics, createRankServices, type Program } from '../src/index.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
function analyze(source: string) {
    const parsed = parser.parse<Program>(source);
    expect(parsed.lexerErrors).toEqual([]);
    expect(parsed.parserErrors).toEqual([]);
    return analyzeFunctionScopes(parsed.value);
}
function captures(source: string, name: string) {
    const result = analyze(source);
    const entry = [...result.functions].find(([node]) => node.name === name)!;
    return [...entry[1].captures].map(binding => binding.name).sort();
}

describe('lexical function dependencies', () => {
    it('includes module and enclosing data but excludes callable names and builtins', () => {
        expect(captures(`use numbers
Limit = 6
fun Offset outer
 fun X below = (X + Offset) abs less Limit
 return 1 below
end`, 'below')).toEqual(['Limit', 'Offset']);
    });

    it('resolves later enclosing bindings and diagnoses accidental rebinding', () => {
        const result = analyze(`fun N outer
 fun X inner
  Count = X
  return Count
 end
 Count = N
 return N inner
end`);
        expect(result.diagnostics.map(error => error.message)).toEqual([
            'Count is bound in an enclosing function; pass it as a parameter or use a different local name.',
        ]);
    });

    it('allows parameters to shadow enclosing bindings', () => {
        const source = `Limit = 6
fun Limit outer
 fun Limit inner = Limit + 1
 return Limit inner
end`;
        expect(analyze(source).diagnostics).toEqual([]);
        expect(captures(source, 'inner')).toEqual([]);
    });

    it('keeps distinct identities for equal names in sibling loop scopes', () => {
        const result = analyze(`fun N outer
 for I in 1 to N
  fun X first = X + I
 end
 for I in 1 to N
  fun X second = X + I
 end
 return N
end`);
        const helpers = [...result.functions].filter(([node]) => node.name !== 'outer');
        const first = [...helpers[0][1].captures][0];
        const second = [...helpers[1][1].captures][0];
        expect(first.name).toBe('I');
        expect(second.name).toBe('I');
        expect(first).not.toBe(second);
    });

    it('propagates transitive dependencies through recursive calls', () => {
        expect(captures(`Limit = 6
fun X first
 if X equal 0
  return Limit
 end
 return (X - 1) second
end
fun X second = X first`, 'second')).toEqual(['Limit']);
    });

    it('does not mistake a callee local for an external caller dependency', () => {
        expect(captures(`fun N outer
 Limit = N
 fun X below = X less Limit
 return 1 below
end`, 'outer')).toEqual([]);
    });
});

describe('function scope restrictions', () => {
    it('rejects direct outer writes, including captured containers and module arrays', () => {
        const result = analyze(`use algo
Data = array 1 2
fun N outer
 Total = 0
 Items = new queue
 fun X change
  Total += X
  Items push X
  Data 0 = X
  return X
 end
 return N change
end`);
        expect(result.diagnostics.map(error => error.message)).toEqual([
            'Total is read-only in change; pass mutable state explicitly as a parameter.',
            'Items is read-only in change; pass mutable state explicitly as a parameter.',
            'Data is read-only in change; pass mutable state explicitly as a parameter.',
        ]);
    });

    it('allows explicit mutable parameters and local accumulators', () => {
        expect(analyze(`use algo
fun Items N append
 Total = 0
 for I in 1 to N
  Total += I
  Items push I
 end
 return Total
end`).diagnostics).toEqual([]);
    });

    it('rejects transitive module reads in memo functions', () => {
        const result = analyze(`Scale = 2
fun X scaled = X * Scale
memo X cached = X scaled`);
        expect(result.diagnostics.map(error => error.message)).toEqual([
            'memo cached depends on external data Scale; pass it as a parameter.',
        ]);
    });

    it('rejects transitive observable effects in memo functions', () => {
        const result = analyze(`use io
fun X display
 X print
 return X
end
memo X cached = X display`);
        expect(result.diagnostics.map(error => error.message)).toEqual([
            'memo cached uses print, which has external effects.',
        ]);
    });

    it('permits parameter-derived local state in memo functions', () => {
        expect(analyze(`memo N total
 Result = 0
 for I in 1 to N
  Result += I
 end
 return Result
end`).diagnostics).toEqual([]);
    });
});


describe('indirect capture mutation', () => {
    it('rejects passing captured state through several mutating helpers', () => {
        const result = analyze(`use algo
fun Items append
 Items push 1
 return 0
end
fun Items forward = Items append
fun N outer
 Items = new queue
 fun X inner = Items forward
 return N inner
end`);
        expect(functionMutationDiagnostics(result).map(error => error.message)).toEqual([
            'Items is read-only in inner; pass mutable state explicitly as a parameter.',
        ]);
    });

    it('tracks mutation through a local alias of a captured container', () => {
        const result = analyze(`use algo
Items = new queue
fun X append
 Local = Items
 Local push X
 return X
end`);
        expect(functionMutationDiagnostics(result).map(error => error.message)).toEqual([
            'Items is read-only in append; pass mutable state explicitly as a parameter.',
        ]);
    });

    it('permits mutation of explicit state and fresh local copies', () => {
        const result = analyze(`Data = array 1 2
fun Items append
 Items push 1
 Local = Data copy
 Local 0 = 3
 return Local
end`);
        expect(functionMutationDiagnostics(result)).toEqual([]);
    });

    it('recognizes receiver mutation syntax', () => {
        const result = analyze(`use algo
Items = new set
fun X append
 Items add X
 return X
end`);
        expect(functionMutationDiagnostics(result).map(error => error.message)).toEqual([
            'Items is read-only in append; pass mutable state explicitly as a parameter.',
        ]);
    });
});


describe('nested function escape diagnostics', () => {
    const diagnostics = (source: string) => {
        const parsed = parser.parse<Program>(source);
        expect(parsed.parserErrors).toEqual([]);
        expect(expressionDiagnostics(parsed.value)).toEqual([]);
        return functionScopeDiagnostics(parsed.value).map(item => item.message);
    };

    it('allows callbacks through ordinary synchronous helpers', () => {
        expect(diagnostics(`fun X check predicate = X predicate
fun Limit outer
 fun X below = X less Limit
 return 4 check below
end`)).toEqual([]);
    });

    it.each(['equal', 'not equal'])('allows comparing nested callbacks with %s without retaining them', operator => {
        expect(diagnostics(`fun compare f g = f ${operator} g
fun Limit outer
 fun X below = X less Limit
 return compare below below
end`)).toEqual([]);
    });

    it('rejects returning a nested function through an identity helper', () => {
        expect(diagnostics(`fun identity_fn f = f
fun Limit outer
 fun X below = X less Limit
 return identity_fn below
end`).some(message => message.includes('nested function below cannot be returned'))).toBe(true);
    });

    it('rejects a lazy result that retains a nested predicate', () => {
        expect(diagnostics(`fun Limit outer
 fun X below = X less Limit
 S = 1 to 10 filter below
 return S
end`).some(message => message.includes('lazy result retains nested function below'))).toBe(true);
    });

    it('permits materializing the lazy result before return', () => {
        expect(diagnostics(`use sequences
fun Limit outer
 fun X below = X less Limit
 S = 1 to 10 filter below
 return S array
end`)).toEqual([]);
    });

    it('permits an eager repeat using a nested callback', () => {
        expect(diagnostics(`use sequences
fun Limit outer
 fun X step = X + Limit
 return 0 step repeat 3
end`)).toEqual([]);
    });

    it('permits a binary repeat stopping predicate with read-only captures', () => {
        expect(diagnostics(`use sequences
fun Limit outer
 fun X step = X + 1
 fun Previous Current done = Current at least Limit
 return 0 step repeat 10 till done
end`)).toEqual([]);
    });

    it('invokes a nested nullary function used as a value', () => {
        expect(diagnostics(`fun Limit outer
 fun answer = Limit + 1
 return answer
end`)).toEqual([]);
    });

    it('passes a nullary callback to a synchronous helper without returning the function', () => {
        expect(diagnostics(`fun invoke op = op
fun Limit outer
 fun answer = Limit + 1
 return invoke answer
end`)).toEqual([]);
    });

    it('rejects returning the lazy result of a nested generator', () => {
        expect(diagnostics(`fun Limit outer
 fun values
  yield Limit
 end
 return values
end`).some(message => message.includes('lazy result retains nested function values'))).toBe(true);
    });

    it('preserves callback provenance in the result of repeat', () => {
        expect(diagnostics(`use sequences
fun Limit outer
 fun X below = X less Limit
 fun X step = 1 to X filter below
 return 10 step repeat 1
end`).some(message => message.includes('lazy result retains nested function below'))).toBe(true);
    });

    it('follows a callback into a helper that stores it in a container', () => {
        expect(diagnostics(`use algo
fun Items save f
 Items push f
 return 0
end
fun Limit outer
 Items = new queue
 fun X below = X less Limit
 Items save below
 return 0
end`).some(message => message.includes('nested function below cannot be returned'))).toBe(true);
    });

    it('permits a helper to return a lazy pipeline to the callback owner for materialization', () => {
        expect(diagnostics(`use sequences
fun Xs filtered predicate = Xs filter predicate
fun Limit outer
 fun X below = X less Limit
 S = (1 to 10) filtered below
 return S array
end`)).toEqual([]);
    });
});
