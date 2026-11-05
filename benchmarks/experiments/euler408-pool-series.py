"""Follow-up scratch-buffer experiment, after the main series."""
import subprocess,json,sys
node=sys.argv[1] if len(sys.argv)>1 else 'node'
output=sys.argv[2] if len(sys.argv)>2 else '/tmp/rank408-pool-series-mac.jsonl'
with open(output,'w') as stream:
 for i in range(3):
  result=subprocess.run([node,'--import','./benchmarks/experiments/euler408-modular-prototype.mjs','--import','./benchmarks/experiments/euler408-pool-prototype.mjs','benchmarks/euler408-investigation.mjs','benchmarks/experiments/euler408-candidate.ra','10000000','compiled'],capture_output=True,text=True,check=True,timeout=180)
  row=json.loads(result.stdout);assert row['answer']=='299742733';stream.write(json.dumps(row)+'\n');stream.flush();print(row['ms'],row['rssMiB'],flush=True)
