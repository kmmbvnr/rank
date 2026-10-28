# Deterministic 32 MiB matrix; independent NumPy references for each GPU chunk.
import json,struct,pathlib,sys,numpy as np
root=pathlib.Path(sys.argv[1]).resolve();root.mkdir()
rng=np.random.default_rng(20261028)
w=(rng.standard_normal((8192,1024))*0.01).astype('<f4')
x=np.sin(np.arange(8192)*0.013).astype('<f4')
header=json.dumps({'weight':{'dtype':'F32','shape':list(w.shape),'data_offsets':[0,w.nbytes]}}).encode()
(root/'chunks.safetensors').write_bytes(struct.pack('<Q',len(header))+header+w.tobytes())
parts=[x[i:i+2048].astype(np.float64)@w[i:i+2048].astype(np.float64) for i in range(0,8192,2048)]
(root/'fixture.json').write_text(json.dumps({'x':x.tolist(),'parts':[p.tolist() for p in parts],'expected':np.sum(parts,axis=0).tolist(),'demoExpected':(np.full(8192,0.5)@w.astype(np.float64)).tolist(),'headerBytes':8+len(header)}))
