import subprocess,json,os,sys
node=sys.argv[1] if len(sys.argv)>1 else 'node'
output=sys.argv[2] if len(sys.argv)>2 else '/tmp/rank407-incremental-series-mac.jsonl'
with open(output,'w') as f:
 for i in range(3):
  run=subprocess.run([node,'--import','./benchmarks/experiments/euler407-prototype.mjs','benchmarks/euler404-investigation.mjs','benchmarks/experiments/euler407-incremental.ra','10000000','compiled'],env={**os.environ,'RANK407_LARGE_PROBE':'1'},text=True,capture_output=True,check=True,timeout=100)
  p=json.loads(run.stdout);assert p['answer']=='39782849136421';f.write(json.dumps(p)+'\n');f.flush();print(p['ms'],p['rssMiB'],flush=True)
