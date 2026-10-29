"""Write every byte of a dense weight bank and an independent float64 reference."""
import argparse, hashlib, json, os
import numpy as np
p=argparse.ArgumentParser();p.add_argument('directory');p.add_argument('--layers',type=int,default=256);p.add_argument('--width',type=int,default=1024)
a=p.parse_args();os.makedirs(a.directory,exist_ok=True)
shape=[a.layers,a.width,a.width];length=int(np.prod(shape))*4
header=json.dumps({'weights':{'dtype':'F32','shape':shape,'data_offsets':[0,length]}},separators=(',',':')).encode()
header+=b' '*((-len(header))%8);prefix=len(header).to_bytes(8,'little')+header
initial=np.full(a.width,.5,dtype=np.float32)
x=initial.astype(np.float64);rng=np.random.default_rng(193);digest=hashlib.sha256()
path=os.path.join(a.directory,'stream.safetensors')
with open(path,'wb') as f:
 f.write(prefix);digest.update(prefix)
 for i in range(a.layers):
  w=(rng.standard_normal((a.width,a.width),dtype=np.float32)*np.float32(.01/np.sqrt(a.width))).astype('<f4')
  data=w.tobytes();f.write(data);digest.update(data)
  x=x+x@w.astype(np.float64)
metadata={'shape':shape,'weightBytes':length,'headerBytes':len(prefix),'fileBytes':len(prefix)+length,'sha256':digest.hexdigest(),'input':initial.tolist(),'expected':x.tolist()}
with open(os.path.join(a.directory,'reference.json'),'w') as f:json.dump(metadata,f)
print(json.dumps({k:v for k,v in metadata.items() if k not in ('input','expected')}))
