# Research only: patch a separate built JS runtime, never the production tree.
import pathlib,sys
path=pathlib.Path(sys.argv[1])/'jit/integer-loop-expressions.js'
s=path.read_text()
needle='''            substitute: source => {'''
assert s.count(needle)==1
s=s.replace(needle,needle+'''
                if (numberMode && host.nativeCalls && host.extrema && isApplicationExpression(source)) {
                    const parts = flattenApplication(source), last = parts.at(-1);
                    if (parts.length === 2 && isNameExpression(last) && ['min', 'max'].includes(last.name)
                        && !localTypes.has(last.name) && !arrays.has(last.name) && !containers.has(last.name)
                        && arrayType(parts[0])?.element === 'integer') {
                        const setup = [], vector = numberVector(parts[0], setup);
                        if (vector) {
                            const index = `extremeIndex${state.serial++}`, result = `extreme${state.serial++}`, body = [];
                            const value = vector.cell(index, body);
                            if (!value) return undefined;
                            builtins.set(last.name, 'core');
                            setup.push(`if (${vector.size} === 0) throw overflow; let ${result} = 0;`,
                                numberVectorLoop(vector.size, index, [...body,
                                `if (${index} === 0 || ${value.code} ${last.name === 'max' ? '>' : '<'} ${result}) ${result} = ${value.code};`]));
                            return { type: 'integer', input: { term: { code: result, type: 'integer' }, lines: setup } };
                        }
                    }
                }
''')
path.write_text(s)
