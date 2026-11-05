import sys,subprocess,json,statistics,pathlib
node,base,output=sys.argv[1:]
p=pathlib.Path('packages/interpreter/out/rank-application.js')
candidate=p.read_bytes();baseline=(pathlib.Path(base)/p).read_bytes();rows=[]
try:
 for case,warm in [('491',False),('491',True),('077',False)]:
  for i in range(9):
   for mode in (['baseline','candidate'] if i%2==0 else ['candidate','baseline']):
    p.write_bytes(baseline if mode=='baseline' else candidate)
    cmd=[node,'--expose-gc',f'--random-seed={201+i}','benchmarks/v8-ranked-cell-memory.mjs','.',case]
    if warm:cmd.append('--warm')
    r=json.loads(subprocess.check_output(cmd,text=True));r.update(case=case,warm=warm,mode=mode,sample=i,seed=201+i);rows.append(r)
  for mode in ['baseline','candidate']:
   rs=[r for r in rows if r['case']==case and r['warm']==warm and r['mode']==mode]
   print(case,warm,mode,{k:statistics.median(r[k] for r in rs) for k in ['milliseconds','heapUsed','peakRssKiB']},flush=True)
finally:p.write_bytes(candidate)
pathlib.Path(output).write_text(json.dumps(rows,indent=2)+'\n')
