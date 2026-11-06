# Research-only scalar Number gcd lowering, separate built runtime.
import pathlib,sys
path=pathlib.Path(sys.argv[1])/'jit/scalar-function-kernel.js'
s=path.read_text().replace("'count', 'powmod'].includes(name)","'count', 'powmod', 'gcd'].includes(name)")
needle="if (compiled.operation.module === 'numbers' && name === 'powmod'"
assert s.count(needle)==1
addition="""if (compiled.operation.module === 'numbers' && name === 'gcd' && compiled.arguments.length === 2
                && compiled.arguments.every(argument => argument.type === 'integer')) {
                const args = compiled.arguments.map(argument => lowerNum(argument, lines));
                if (args.some(argument => argument === undefined)) return undefined;
                const a = `gcdA${serial++}`, b = `gcdB${serial++}`, r = `gcdR${serial++}`;
                lines.push(`let ${a} = Math.abs(${args[0]}), ${b} = Math.abs(${args[1]}); checkpoint();
                    while (${b} !== 0) { const ${r} = ${a} % ${b}; ${a} = ${b}; ${b} = ${r}; }`);
                return a;
            }
            """
s=s.replace(needle,addition+needle)
path.write_text(s)
