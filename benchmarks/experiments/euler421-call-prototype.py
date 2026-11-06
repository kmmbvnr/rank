# Research-only integer non-leaf Number entry, separate built runtime.
import pathlib,sys
path=pathlib.Path(sys.argv[1])/'function-invocation.js'
s=path.read_text()
needle='''                                this.compiler.hooks.onScalarFunctionExecuted?.();
                                return kernelDirect(...arguments_);'''
assert s.count(needle)==1
s=s.replace(needle,'''                                this.compiler.hooks.onScalarFunctionExecuted?.();
                                if (rawNumber && kernel.returnType === 'integer' && !kernel.plans && !kernel.numberStorage
                                    && !kernel.memberships.length && !kernel.scalarCaptures.length && privateLoopPolling() && !demandBudgetEnabled()
                                    && arguments_.every(a => typeof a === 'bigint' && Number.isSafeInteger(Number(a)))) {
                                    try {
                                        const diagnostics = currentDiagnostics();
                                        if (diagnostics) diagnostics.numberFunctions++;
                                        return BigInt(rawNumber(...arguments_.map(Number)));
                                    } catch (error) {
                                        if (error !== numberOverflow) throw error;
                                        const diagnostics = currentDiagnostics();
                                        if (diagnostics) diagnostics.numberFunctionFallbacks++;
                                    }
                                }
                                return kernelDirect(...arguments_);''')
path.write_text(s)
