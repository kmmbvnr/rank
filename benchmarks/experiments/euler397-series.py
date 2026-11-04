import subprocess,json,os,sys
p=sys.argv[1] if len(sys.argv)>1 else '/tmp/rank397-series.jsonl'
with open(p,'w') as f:
 for trial in range(3):
  cases=[('original','1000000','compiled',False),('pruned','1000000','compiled',False),('pruned','1000000','compiled',True),('original','10000','reference',False),('pruned','10000','reference',False)]
  for source,k,mode,sink in cases:
   cmd=['node']+(['--import','./benchmarks/experiments/euler397-wide-sink.mjs'] if sink else [])+['benchmarks/euler397-followup.mjs',k,mode,f'benchmarks/experiments/euler397-{source}.ra']
   env={**os.environ,'SINK':str(sink)}
   r=subprocess.run(cmd,capture_output=True,text=True,timeout=100,env=env)
   if r.returncode: raise RuntimeError(r.stderr)
   row={'trial':trial,**json.loads(r.stdout)}
   f.write(json.dumps(row)+'\n');f.flush();print(json.dumps(row),flush=True)
