# GPU check fixture: quantize real QKV to F16, store transposed, prepare back to F32.
# Run with the mlrank Python environment (NumPy) and Node on PATH.
import json,struct,pathlib,shutil,sys,subprocess,os,numpy as np
src=pathlib.Path(sys.argv[1]).resolve();dst=pathlib.Path(sys.argv[2]).resolve();dst.mkdir()
f=json.loads((src/'fixture.json').read_text())
def read(path):
 with open(path,'rb') as r:
  n=struct.unpack('<Q',r.read(8))[0];h=json.loads(r.read(n));k=next(k for k in h if k!='__metadata__');t=h[k];return np.frombuffer(r.read(),dtype='<f4').reshape(t['shape'])
w=read(src/'qkv.safetensors').astype('<f2').T.copy();h=json.dumps({'weight':{'dtype':'F16','shape':list(w.shape),'data_offsets':[0,w.nbytes]}}).encode()
(dst/'source-f16.safetensors').write_bytes(struct.pack('<Q',len(h))+h+w.tobytes())
shutil.copyfile(src/'gpt2-ln1.safetensors',dst/'gpt2-ln1.safetensors')
s=read(src/'gpt2-ln1.safetensors');x=np.array(f['x'],dtype=np.float32)
f['expected']=((x*s).astype(np.float64)@w.T.astype(np.float64)).tolist();f['directory']=str(dst)
(dst/'fixture.json').write_text(json.dumps(f));(dst/'input.index.json').write_text(json.dumps({'weight_map':{'weight':'qkv.safetensors','h.0.ln_1.weight':'gpt2-ln1.safetensors'}}))

repo=pathlib.Path(__file__).resolve().parent.parent
node=os.environ.get('NODE','node')
def run(script,*args):
 return json.loads(subprocess.check_output([node,str(repo/'scripts'/script),*map(str,args)],cwd=repo))
prepared=run('mlrank-prepare-weight.mjs',dst/'source-f16.safetensors','weight',dst/'cache','--transpose')
reused=run('mlrank-prepare-weight.mjs',dst/'source-f16.safetensors','weight',dst/'cache','--transpose')
assert reused['cached'] and prepared['sha256']==reused['sha256']
shutil.copyfile(prepared['path'],dst/'qkv.safetensors')
locked=run('mlrank-lock-checkpoint.mjs',dst/'input.index.json',dst/'locked.safetensors.index.json')
f['manifestSha256']=locked['sha256'];(dst/'fixture.json').write_text(json.dumps(f))
print(json.dumps({'preparation':prepared,'reuse':reused,'gpu':run('mlrank-parts-check.mjs',dst)},indent=2))
