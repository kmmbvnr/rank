import sys,subprocess,json,pathlib,statistics
node,base,output=sys.argv[1:]
p=pathlib.Path('packages/interpreter/out/rank-application.js');saved=p.read_bytes();old=(pathlib.Path(base)/p).read_bytes();rows=[]
try:
 for i in range(5):
  for mode in (['baseline','candidate'] if i%2==0 else ['candidate','baseline']):
   p.write_bytes(old if mode=='baseline' else saved)
   r=json.loads(subprocess.check_output([node,'--expose-gc',f'--random-seed={301+i}','benchmarks/v8-ranked-cell-memory.mjs','.','491','--settle'],text=True));r.update(mode=mode,sample=i);rows.append(r)
finally:p.write_bytes(saved)
pathlib.Path(output).write_text(json.dumps(rows,indent=2)+'\n')
for mode in ['baseline','candidate']:
 rs=[r for r in rows if r['mode']==mode];print(mode,{k:statistics.median(r[k] for r in rs) for k in ['heapSameJob','heapAfterJob']})
