import sys,subprocess,json,statistics,pathlib
node,base,candidate,output=sys.argv[1:]
rows=[]
for case in ['unary','491']:
 for sample in range(9):
  for mode in (['baseline','candidate'] if sample%2==0 else ['candidate','baseline']):
   root=base if mode=='baseline' else candidate
   cmd=[node,'--expose-gc','benchmarks/v8-unary-recheck.mjs',root] if case=='unary' else [node,'--expose-gc','benchmarks/v8-ranked-cell-memory.mjs',root,case]
   row=json.loads(subprocess.check_output(cmd,text=True));row.update(case=case,mode=mode,sample=sample);rows.append(row)
 for mode in ['baseline','candidate']:
  selected=[r for r in rows if r['case']==case and r['mode']==mode]
  print(case,mode,statistics.median(statistics.median(r['times']) if case=='unary' else r['milliseconds'] for r in selected),flush=True)
pathlib.Path(output).write_text(json.dumps(rows,indent=2)+'\n')
