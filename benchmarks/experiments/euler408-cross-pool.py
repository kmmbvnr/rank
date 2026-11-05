"""Adaptive pool against exact-size allocation, other compiler code identical."""
import json,os,subprocess,sys
node=sys.argv[1] if len(sys.argv)>1 else 'node'
output=sys.argv[2] if len(sys.argv)>2 else '/tmp/rank408-cross-pool-mac.jsonl'
cases=[('euler/404_crazyellipses.ra','1199215615081353'),
       ('euler/407_idempotents.ra','39782849136421'),
       ('euler/401_sumsquares.ra','281632621'),
       ('euler/213_fleacircus.ra',None)]
with open(output,'w') as stream:
 for file,golden in cases:
  for ordinal in range(2):
   for exact in ([True,False] if ordinal==0 else [False,True]):
    env={**os.environ,'RANK408_EXACT_POOL':'1' if exact else '0','RANK408_NO_PRODUCT':'0'}
    result=subprocess.run([node,'--import','./benchmarks/experiments/euler408-controls.mjs','benchmarks/euler408-pool-controls.mjs','demos/'+file],env=env,capture_output=True,text=True,check=True,timeout=180)
    row=json.loads(result.stdout)
    if golden is None:golden=row['answer']
    assert row['answer']==golden,row
    row.update(exactPool=exact,round=ordinal)
    stream.write(json.dumps(row)+'\n');stream.flush();print(file,exact,row['ms'],row['rssMiB'],flush=True)
