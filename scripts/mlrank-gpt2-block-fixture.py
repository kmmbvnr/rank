# Pinned GPT-2 block 0, plus the first four token/position embedding rows.
# Downloads byte ranges, keeps weights in Safetensors, uses an independent NumPy reference.
import concurrent.futures,hashlib,json,pathlib,re,struct,subprocess,sys,numpy as np
REV='607a30d783dfa663caf39e06633721c8d4cfcd7e'
BASE='https://huggingface.co/openai-community/gpt2/resolve/'+REV+'/'
root=pathlib.Path(sys.argv[1]).resolve();root.mkdir();raw=root/'raw';raw.mkdir()
def download(label,start,end):
 p=raw/(label+'.bin');headers=raw/(label+'.headers')
 subprocess.run(['curl','-fLsS','--retry','2','-H',f'Range: bytes={start}-{end}','-D',str(headers),'-o',str(p),BASE+'model.safetensors?rank-block0='+label],check=True)
 ranges=re.findall(r'(?im)^content-range:\s*bytes (\d+)-(\d+)/(\d+)',headers.read_text())
 if not ranges or tuple(map(int,ranges[-1][:2]))!=(start,end) or p.stat().st_size!=end-start+1:raise ValueError('Server did not return the requested range: '+label)
 print('downloaded '+label, file=sys.stderr,flush=True);return p
prefix=download('header',0,19999).read_bytes();header_size=struct.unpack('<Q',prefix[:8])[0];assert header_size<=len(prefix)-8
header=json.loads(prefix[8:8+header_size]);base=8+header_size
subprocess.run(['curl','-fLsS','-o',str(root/'config.json'),BASE+'config.json'],check=True)
config=json.loads((root/'config.json').read_text());assert (config['n_embd'],config['n_head'],config['activation_function'],config['layer_norm_epsilon'])==(768,12,'gelu_new',1e-5)
names=['h.0.ln_1.weight','h.0.ln_1.bias','h.0.attn.c_attn.weight','h.0.attn.c_attn.bias','h.0.attn.c_proj.weight','h.0.attn.c_proj.bias','h.0.ln_2.weight','h.0.ln_2.bias','h.0.mlp.c_fc.weight','h.0.mlp.c_fc.bias','h.0.mlp.c_proj.weight','h.0.mlp.c_proj.bias','wte.weight','wpe.weight']
entries=[]
for name in names:
 t=header[name];assert t['dtype']=='F32';shape=t['shape'] if name.startswith('h.0.') else [4,768]
 length=int(np.prod(shape))*4;start=base+t['data_offsets'][0]
 entries.append({'name':name,'shape':shape,'start':start,'length':length,'originalShape':t['shape']})
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 paths=list(pool.map(lambda e:download(e['name'],e['start'],e['start']+e['length']-1),entries))
out_header={'__metadata__':{'source_revision':REV,'extraction':'GPT-2 block 0; token and positional embeddings contain only rows 0..3'}};offset=0
for e,p in zip(entries,paths):
 out_header[e['name']]={'dtype':'F32','shape':e['shape'],'data_offsets':[offset,offset+e['length']]};offset+=e['length'];e['sha256']=hashlib.sha256(p.read_bytes()).hexdigest()
h=json.dumps(out_header,separators=(',',':')).encode();h+=b' '*((-len(h))%8)
with open(root/'gpt2-block0.safetensors','wb') as out:
 out.write(struct.pack('<Q',len(h)));out.write(h)
 for p in paths:
  with open(p,'rb') as f:
   while b:=f.read(65536):out.write(b)
weights={e['name']:np.memmap(p,dtype='<f4',mode='r',shape=tuple(e['shape'])).astype(np.float64) for e,p in zip(entries,paths)}
def w(n):return weights['h.0.'+n]
def norm(x,g,b):
 centered=x-x.mean(axis=-1,keepdims=True)
 return centered/np.sqrt((centered*centered).mean(axis=-1,keepdims=True)+1e-5)*g+b
def reference(x):
 n=norm(x,w('ln_1.weight'),w('ln_1.bias'));p=n@w('attn.c_attn.weight')+w('attn.c_attn.bias')
 q,k,v=[a.reshape(1,4,12,64).transpose(0,2,1,3) for a in np.split(p,3,axis=-1)]
 scores=(q@k.transpose(0,1,3,2))*0.125+np.where(np.triu(np.ones((4,4)),1),-10000.,0.)
 probs=np.exp(scores-scores.max(axis=-1,keepdims=True));probs/=probs.sum(axis=-1,keepdims=True)
 context=(probs@v).transpose(0,2,1,3).reshape(1,4,768)
 a=context@w('attn.c_proj.weight')+w('attn.c_proj.bias');h=x+a
 n2=norm(h,w('ln_2.weight'),w('ln_2.bias'));up=n2@w('mlp.c_fc.weight')+w('mlp.c_fc.bias')
 gelu=.5*up*(1+np.tanh(np.sqrt(2/np.pi)*(up+.044715*up**3)))
 result=h+gelu@w('mlp.c_proj.weight')+w('mlp.c_proj.bias')
 return {'Norm1':n,'Projection':p,'Probabilities':probs,'Attention':a,'Residual1':h,'Norm2':n2,'Up':up,'Activated':gelu,'Output':result}
x=(weights['wte.weight']+weights['wpe.weight']).astype(np.float32).reshape(1,4,768)
changed=x.copy();changed[0,-1]+=np.sin(np.arange(768)*.11).astype(np.float32)*.25
cases=[]
for value in [x,changed]:cases.append({'input':value.ravel().tolist(),'stages':{n:v.ravel().tolist() for n,v in reference(value.astype(np.float64)).items()}})
np.testing.assert_array_equal(cases[0]['stages']['Output'][:3*768],cases[1]['stages']['Output'][:3*768])
sha=hashlib.sha256((root/'gpt2-block0.safetensors').read_bytes()).hexdigest()
json.dump({'revision':REV,'sourceUrl':BASE+'model.safetensors','entries':entries,'sha256':sha,'headerBytes':8+len(h),'cases':cases},open(root/'fixture.json','w'))
print(json.dumps({'directory':str(root),'sha256':sha,'payloadBytes':offset,'tensors':len(entries)}))
