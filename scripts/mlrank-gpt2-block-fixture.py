# Pinned GPT-2 block 0 or all 12 blocks, plus four token/position embedding rows.
# Downloads byte ranges, keeps weights in Safetensors, uses an independent NumPy reference.
import argparse,concurrent.futures,hashlib,json,pathlib,re,struct,subprocess,sys,numpy as np
REV='607a30d783dfa663caf39e06633721c8d4cfcd7e'
BASE='https://huggingface.co/openai-community/gpt2/resolve/'+REV+'/'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('directory')
parser.add_argument('--layers',type=int,choices=[1,12],default=1)
parser.add_argument('--full-vocabulary',action='store_true')
args=parser.parse_args();layers=args.layers
if args.full_vocabulary and layers!=12:parser.error('--full-vocabulary requires --layers 12')
filename='gpt2-block0.safetensors' if layers==1 else 'gpt2-stack.safetensors'
if args.full_vocabulary:filename='gpt2-forward.safetensors'
root=pathlib.Path(args.directory).resolve();root.mkdir();raw=root/'raw';raw.mkdir()
def download(label,start,end):
 p=raw/(label+'.bin');headers=raw/(label+'.headers')
 subprocess.run(['curl','-fLsS','--retry','2','-H',f'Range: bytes={start}-{end}','-D',str(headers),'-o',str(p),BASE+f'model.safetensors?rank-block0={label}-{start}-{end}'],check=True)
 ranges=re.findall(r'(?im)^content-range:\s*bytes (\d+)-(\d+)/(\d+)',headers.read_text())
 if not ranges or tuple(map(int,ranges[-1][:2]))!=(start,end) or p.stat().st_size!=end-start+1:raise ValueError('Server did not return the requested range: '+label)
 print('downloaded '+label, file=sys.stderr,flush=True);return p
prefix=download('header',0,19999).read_bytes();header_size=struct.unpack('<Q',prefix[:8])[0];assert header_size<=len(prefix)-8
header=json.loads(prefix[8:8+header_size]);base=8+header_size
subprocess.run(['curl','-fLsS','-o',str(root/'config.json'),BASE+'config.json'],check=True)
config=json.loads((root/'config.json').read_text());assert config['n_layer']==12
assert (config['n_embd'],config['n_head'],config['activation_function'],config['layer_norm_epsilon'])==(768,12,'gelu_new',1e-5)
names=['h.0.ln_1.weight','h.0.ln_1.bias','h.0.attn.c_attn.weight','h.0.attn.c_attn.bias','h.0.attn.c_proj.weight','h.0.attn.c_proj.bias','h.0.ln_2.weight','h.0.ln_2.bias','h.0.mlp.c_fc.weight','h.0.mlp.c_fc.bias','h.0.mlp.c_proj.weight','h.0.mlp.c_proj.bias','wte.weight','wpe.weight']
if layers==12:
 names=[n.replace('h.0.',f'h.{layer}.') for layer in range(12) for n in names if n.startswith('h.0.')]+['wte.weight','wpe.weight','ln_f.weight','ln_f.bias']
entries=[]
for name in names:
 t=header[name];assert t['dtype']=='F32';shape=[4,768] if not args.full_vocabulary and name in ('wte.weight','wpe.weight') else t['shape']
 length=int(np.prod(shape))*4;start=base+t['data_offsets'][0]
 entries.append({'name':name,'shape':shape,'start':start,'length':length,'originalShape':t['shape']})
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
 paths=list(pool.map(lambda e:download(e['name'],e['start'],e['start']+e['length']-1),entries))
extraction='GPT-2 block 0' if layers==1 else 'GPT-2 blocks 0..11 and final LayerNorm'
extraction+=('; full token and positional embeddings' if args.full_vocabulary else '; token and positional embeddings contain only rows 0..3')
out_header={'__metadata__':{'source_revision':REV,'extraction':extraction}};offset=0
for e,p in zip(entries,paths):
 out_header[e['name']]={'dtype':'F32','shape':e['shape'],'data_offsets':[offset,offset+e['length']]};offset+=e['length'];
 with open(p,'rb') as f:e['sha256']=hashlib.file_digest(f,'sha256').hexdigest()
h=json.dumps(out_header,separators=(',',':')).encode();h+=b' '*((-len(h))%8)
with open(root/filename,'wb') as out:
 out.write(struct.pack('<Q',len(h)));out.write(h)
 for p in paths:
  with open(p,'rb') as f:
   while b:=f.read(65536):out.write(b)
entries_by_name={e['name']:(e,p) for e,p in zip(entries,paths)}
def weight(name,rows=None):
 e,p=entries_by_name[name]
 mapped=np.memmap(p,dtype='<f4',mode='r',shape=tuple(e['shape']))
 return (mapped if rows is None else mapped[rows]).astype(np.float64)
weights={}
def w(n):return weights[n]
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
if args.full_vocabulary:
 assert config['vocab_size']==50257 and config['n_positions']==1024
 token_cases=[[0,127,8192,50256],[0,127,8192,256]]
 positions=[0,1,2,3]
 inputs=[(weight('wte.weight',ids)+weight('wpe.weight',positions)).astype(np.float32).reshape(1,4,768) for ids in token_cases]
else:
 x=(weight('wte.weight')+weight('wpe.weight')).astype(np.float32).reshape(1,4,768)
 changed=x.copy();changed[0,-1]+=np.sin(np.arange(768)*.11).astype(np.float32)*.25
 inputs=[x,changed]
cases=[{'input':value.ravel().tolist(),'blocks':[]} for value in inputs]
if args.full_vocabulary:
 for i,c in enumerate(cases):c.update(tokens=token_cases[i],positions=positions)
values=[value.astype(np.float64) for value in inputs]
for layer in range(layers):
 prefix=f'h.{layer}.'
 weights={name[len(prefix):]:weight(name) for name in entries_by_name if name.startswith(prefix)}
 for i,value in enumerate(values):
  stages=reference(value)
  if layers==1:cases[i]['stages']={n:v.ravel().tolist() for n,v in stages.items()}
  cases[i]['blocks'].append({n:stages[n].ravel().tolist() for n in ['Residual1','Output']})
  values[i]=stages['Output']
 np.testing.assert_array_equal(values[0][:,:3],values[1][:,:3])
if layers==12:
 for i,value in enumerate(values):cases[i]['final']=norm(value,weight('ln_f.weight'),weight('ln_f.bias')).ravel().tolist()
if args.full_vocabulary:
 for c in cases:
  hidden=np.array(c['final']).reshape(4,768)
  logits=np.empty((4,50257),dtype=np.float64)
  for start in range(0,50257,1024):logits[:,start:start+1024]=hidden@weight('wte.weight',slice(start,start+1024)).T
  c['logits']=logits.ravel().tolist();c['argmax']=logits.argmax(axis=1).tolist()
 np.testing.assert_array_equal(np.array(cases[0]['logits']).reshape(4,50257)[:3],np.array(cases[1]['logits']).reshape(4,50257)[:3])
# Stream the checksum so extending the fixture does not allocate the whole file.
with open(root/filename,'rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
json.dump({'revision':REV,'sourceUrl':BASE+'model.safetensors','entries':entries,'sha256':sha,'headerBytes':8+len(h),'layers':layers,'fullVocabulary':args.full_vocabulary,'filename':filename,'cases':cases},open(root/'fixture.json','w'))
print(json.dumps({'directory':str(root),'sha256':sha,'payloadBytes':offset,'tensors':len(entries)}))
