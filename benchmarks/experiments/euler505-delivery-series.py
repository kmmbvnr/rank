import json,os,subprocess,sys,time
from pathlib import Path
root=Path(sys.argv[1]);node=sys.argv[2];destination=Path(sys.argv[3]);rows=[]
def run(id,size='full',mode='compiled',variant='original',control='',kind='final'):
 env=dict(os.environ,CONTROL=control,DIAGNOSTICS='',PROFILE='',LC='')
 command=[node,'benchmarks/euler505-investigation.mjs',str(id),str(size),mode,variant]
 p=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=300 if id==505 else 180)
 if p.returncode:raise RuntimeError(f'{command}: {p.stderr}')
 row=json.loads(p.stdout);row['kind']=kind;rows.append(row);destination.write_text(json.dumps(rows,indent=2));print(json.dumps({k:row[k] for k in ['id','size','mode','variant','controls','kind','ms','answer','rssMiB']}),flush=True)
for trial in range(3):
 for id in [501,502,504,507,511,513]:run(id)
run(505)
for trial in range(3):
 run(501,10000000000,variant='baseline',kind='source-control');run(501,10000000000,kind='source-control')
 run(507,100000,variant='baseline',kind='source-control');run(507,100000,kind='source-control')
 run(513,10000,variant='baseline',kind='source-control');run(513,10000,kind='source-control')
 run(504,control='packed',kind='runtime-control');run(504,kind='runtime-control')
 run(505,1000000000,variant='baseline',control='choose',kind='compiler-control');run(505,1000000000,variant='baseline',kind='compiler-control')
 run(507,10000,control='abs',kind='compiler-control');run(507,10000,kind='compiler-control')
run(502,variant='range-fixed',kind='source-control')
for id in [502,504,511,513]:run(id,mode='reference',kind='reference-full')
for id,size in [(501,100000000),(507,1000)]:
 run(id,size,mode='reference',variant='baseline',kind='reference-small');run(id,size,mode='reference',kind='reference-small')
