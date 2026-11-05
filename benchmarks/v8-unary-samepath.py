import sys,subprocess,json,statistics,pathlib
node,base,output=sys.argv[1:]
p=pathlib.Path('packages/interpreter/out/jit/unary-array-kernel.js')
candidate=p.read_bytes();baseline=(pathlib.Path(base)/p).read_bytes();rows=[]
try:
 for case in ['unary','491']:
  for i in range(9):
   for mode in (['baseline','candidate'] if i%2==0 else ['candidate','baseline']):
    p.write_bytes(baseline if mode=='baseline' else candidate)
    script=['benchmarks/v8-unary-recheck.mjs','.'] if case=='unary' else ['benchmarks/v8-ranked-cell-memory.mjs','.',case]
    r=json.loads(subprocess.check_output([node,'--expose-gc',f'--random-seed={101+i}',*script],text=True));r.update(case=case,mode=mode,sample=i,seed=101+i);rows.append(r)
  for mode in ['baseline','candidate']:
   rs=[r for r in rows if r['case']==case and r['mode']==mode];print(case,mode,statistics.median(statistics.median(r['times']) if case=='unary' else r['milliseconds'] for r in rs),flush=True)
finally:p.write_bytes(candidate)
pathlib.Path(output).write_text(json.dumps(rows,indent=2)+'\n')
