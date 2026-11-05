"""Fresh-process baseline, same-source compiler/pool controls and final program."""
import json,os,subprocess,sys
node=sys.argv[1] if len(sys.argv)>1 else 'node'
output=sys.argv[2] if len(sys.argv)>2 else '/tmp/rank408-final-series-mac.jsonl'
original='benchmarks/experiments/euler408-original.ra'
final='demos/euler/408_admissiblepaths.ra'
variants=[('original-control',original,True,True),('program-only',final,True,True),
          ('exact-pool',final,False,True),('final',final,False,False)]
def run(label,file,no_product,exact_pool,mode='compiled'):
 env={**os.environ,'RANK408_NO_PRODUCT':'1' if no_product else '0','RANK408_EXACT_POOL':'1' if exact_pool else '0'}
 result=subprocess.run([node,'--import','./benchmarks/experiments/euler408-controls.mjs','benchmarks/euler408-followup.mjs',file,'10000000',mode],env=env,capture_output=True,text=True,check=True,timeout=180)
 row=json.loads(result.stdout);assert row['answer']=='299742733';assert row['points']=='7850';row['label']=label;return row
with open(output,'w') as stream:
 for ordinal in range(3):
  for label,file,no_product,exact_pool in variants if ordinal%2==0 else variants[::-1]:
   row=run(label,file,no_product,exact_pool);row['round']=ordinal;stream.write(json.dumps(row)+'\n');stream.flush();print(label,row['ms'],row['rssMiB'],flush=True)
 for label,file in [('original-reference',original),('final-reference',final)]:
  row=run(label,file,False,False,'reference');stream.write(json.dumps(row)+'\n');stream.flush();print(label,row['ms'],row['rssMiB'],flush=True)
