const escape = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function distribution(results) {
 const edges = [100, 300, 1000, 3000, 10000, 30000, 60000, 180000, 600000, Infinity];
 const labels = ['<100 ms', '100–300 ms', '0.3–1 s', '1–3 s', '3–10 s', '10–30 s', '30–60 s', '1–3 min', '3–10 min', '≥10 min'];
 const times = results.filter(x => x.status === 'ok' && Number.isFinite(x.ms) && x.ms >= 0).map(x => x.ms).sort((a,b) => a-b);
 const counts = edges.map(() => 0);
 const timeoutCounts = edges.map(() => 0);
 const errorCounts = edges.map(() => 0);
 for (const row of results.filter(x => ['error','memory-limit','interrupted'].includes(x.status))) {
  if (Number.isFinite(row.ms) && row.ms >= 0) errorCounts[edges.findIndex(edge => row.ms < edge)]++;
 }
 for (const row of results.filter(x => x.status === 'timeout')) {
  const ms = Number.isFinite(row.ms) && row.ms >= 0 ? row.ms : 600000;
  timeoutCounts[edges.findIndex(edge => ms < edge)]++;
 }
 for (const ms of times) counts[edges.findIndex(edge => ms < edge)]++;
 const percentile = p => times.length ? times[Math.max(0, Math.ceil(p * times.length) - 1)] : null;
 return {labels, counts, timeoutCounts, errorCounts, count: times.length, median: times.length ? (times[Math.floor((times.length-1)/2)] + times[Math.floor(times.length/2)]) / 2 : null, p90: percentile(0.9)};
}
function histogram(run) {
 const data = distribution(run.results);
 const time = ms => ms == null ? '—' : ms < 1000 ? ms.toFixed(0) + ' ms' : ms < 60000 ? (ms/1000).toFixed(1) + ' s' : (ms/60000).toFixed(1) + ' min';
 const max = Math.max(1, ...data.counts.map((n,i) => n + data.timeoutCounts[i] + data.errorCounts[i]));
 const bars = data.counts.map((n,i) => {
  const x = 55 + i * 91, height = n / max * 170;
  const timeouts = data.timeoutCounts[i], errors = data.errorCounts[i];
  const redHeight = (timeouts + errors) / max * 170;
  const count = n + timeouts + errors;
  return `<rect x="${x}" y="${205-height}" width="65" height="${height}" rx="4" fill="#70b8ee"><title>${data.labels[i]}: ${n} successful demos</title></rect><rect x="${x}" y="${205-height-redHeight}" width="65" height="${redHeight}" rx="4" fill="#ff9696"><title>${data.labels[i]}: ${errors} errors, ${timeouts} timeouts</title></rect><text x="${x+32.5}" y="${195-height-redHeight}" text-anchor="middle" fill="#dae2ef" font-size="16">${count || ''}</text><text x="${x+32.5}" y="232" text-anchor="middle" fill="#aabbd2" font-size="13">${data.labels[i]}</text>`;
 }).join('');
 const timeouts = run.results.filter(x => x.status === 'timeout').length;
 const errors = run.results.filter(x => ['error','memory-limit','interrupted'].includes(x.status)).length;
 return `<section id="distribution"><h2>Execution time distribution</h2><p><strong>Median ${time(data.median)}</strong> · 90% of successful demos finish within <strong>${time(data.p90)}</strong></p><svg viewBox="0 0 1000 265" role="img" aria-label="Distribution of demo execution times including errors and timeouts" style="width:100%;max-height:320px"><text x="55" y="18" fill="#9eacc0" font-size="14">Number of demos</text><line x1="45" y1="205" x2="965" y2="205" stroke="#475569"/>${bars}<text x="500" y="260" text-anchor="middle" fill="#9eacc0" font-size="14">Execution time · fixed time buckets</text></svg><small>${data.count} successful demos · ${run.results.length}/${run.total} processed · ${timeouts} timeouts · ${errors} errors. <span style="color:#70b8ee">Blue: successful</span> · <span style="color:#ff9696">Red: errors / timeouts</span>. Median and percentile use successful runs. This overview covers the whole run, regardless of table filters.</small></section>`;
}
function headerHtml(run, esc) {
 return `<h1>Rank · nightly benchmarks</h1><p>${esc(run.host)} · ${esc(run.cpu)} · Node ${esc(run.node)}</p><p><a href="https://github.com/kmmbvnr/rank/commit/${esc(run.commit)}">${esc(run.commit.slice(0,12))}</a> ${esc(run.subject)}</p><small>${esc(run.started)} · <b>${esc(run.status)}</b> · updated ${esc(run.updated)}<br>${esc(run.method)} Timeout: ${run.timeoutMs / 60000} minutes per workload. JS heap: 4 GiB; Linux memory cap: 6 GiB (RSS fallback). Other host activity can affect timings.</small><p>${esc(run.current ? 'Running: ' + run.current : run.error || '')}</p><a href="latest.json">Latest JSON</a> · <a href="runs/">Run archive</a>`;
}
export function render(run, previous) {
 const json = x => JSON.stringify(x).replaceAll('<', '\\u003c');
 return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rank nightly benchmarks</title>
<style>
:root{font:15px system-ui;color:#dae2ef;background:#101722}body{max-width:1400px;margin:auto;padding:28px}h1{font-size:30px;margin-bottom:8px}a{color:#8cc8ff}small,.muted{color:#9eacc0}header{border-bottom:1px solid #334155;padding-bottom:22px}.cards{display:flex;gap:16px;flex-wrap:wrap;margin:24px 0}.card{background:#1b2636;padding:16px 24px;border-radius:10px}.card strong{display:block;font-size:25px}input,select,button{font:inherit;color:inherit;background:#1b2636;border:1px solid #475569;padding:8px;border-radius:5px}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{text-align:left;padding:9px;border-bottom:1px solid #2b3749}th{cursor:pointer;color:#aabbd2}td.num{text-align:right;font-variant-numeric:tabular-nums}.bad{color:#ff9696}.good{color:#80dfb1}details{cursor:pointer}pre{white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;font:12px monospace}svg{vertical-align:middle}.tools{display:flex;gap:12px;flex-wrap:wrap}#detail{background:#1b2636;padding:18px;margin-top:20px;border-radius:8px}tr:hover{background:#1b2636}code{font-size:13px}section{margin-top:28px}@media(max-width:750px){body{padding:12px}td,th{padding:7px;font-size:12px}.wide{display:none}}
</style><header id="report-header">${headerHtml(run, escape)}</header>
<p id="job" class="muted"></p><div class="tools">
<label>Run <select id="run"><option value="">Latest run</option></select></label>
<label>Compare with <select id="baseline"><option value="">Previous completed run</option></select></label>
<button id="refresh" type="button">Refresh</button><span id="feedback" role="status" aria-live="polite"></span>
</div><div class="cards" id="cards"></div><div id="histogram">${histogram(run)}</div><div class="tools">
<input id="query" aria-label="Filter demo path" placeholder="Filter demo path">
<select id="status" aria-label="Filter status"><option value="">All statuses</option><option>ok</option><option>error</option><option>timeout</option><option>memory-limit</option><option>no-workload</option><option>no-data</option></select></div>
<section><h2>Groups</h2><small>Change is the geometric mean of ratios for successful, matching workloads ≥100 ms in both runs. Positive means slower. Source/test changes are excluded; dependency or environment changes can still affect results.</small><table id="groups"></table></section>
<section><h2>Individual demos</h2><small>Click a demo for output and recent history. Single samples are noisy; startup imports are excluded. Click column titles to sort.</small><table><thead><tr><th data-sort="path">Demo</th><th data-sort="kind">Workload</th><th data-sort="status">Status</th><th data-sort="ms">Time ↓</th><th>Baseline</th><th>Change</th></tr></thead><tbody id="rows"></tbody></table><div id="detail" hidden></div></section>
<script>
let run=${json(run)};
const initial=${json(previous || null)};
const distribution=${distribution.toString()};
const histogram=${histogram.toString()};
const headerHtml=${headerHtml.toString()};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let baseline=initial, history=[], sort='ms', direction=-1, request=0;
const params=new URLSearchParams(location.search);
const runSelect=document.querySelector('#run'), compareSelect=document.querySelector('#baseline');
const refreshButton=document.querySelector('#refresh'), feedback=document.querySelector('#feedback');
const archive=location.pathname.endsWith('.html');
let selectedRun=params.get('run')||(archive?run.id:'');
let selectedBaseline=params.get('compare')||'';
document.querySelector('#query').value=params.get('q')||'';
document.querySelector('#status').value=params.get('status')||'';
const compatible=x=>x.method===run.method&&x.node===run.node&&x.cpu===run.cpu;
async function readJson(path){
 const response=await fetch(path,{cache:'no-store'});
 if(!response.ok)throw Error('Unable to load '+path+' (HTTP '+response.status+')');
 return response.json();
}
function remember(){
 const url=new URL(location.href);
 const values={run:selectedRun,compare:selectedBaseline,q:document.querySelector('#query').value,status:document.querySelector('#status').value};
 for(const [key,value]of Object.entries(values)){if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);}
 window.history.replaceState(null,'',url);
}
function options(){
 const label=x=>esc(x.id.slice(0,19).replace('T',' ')+' UTC · '+x.commit.slice(0,8));
 runSelect.innerHTML='<option value="">Latest run</option>'+[...history].reverse().filter(x=>x.status==='complete'||x.id===run.id).map(x=>'<option value="'+esc(x.id)+'">'+label(x)+'</option>').join('');
 runSelect.value=selectedRun;
 const candidates=[...history].reverse().filter(x=>x.id!==run.id&&x.status==='complete'&&compatible(x));
 if(selectedBaseline&&!candidates.some(x=>x.id===selectedBaseline))selectedBaseline='';
 compareSelect.innerHTML='<option value="">Previous completed run</option>'+candidates.map(x=>'<option value="'+esc(x.id)+'">'+label(x)+'</option>').join('');
 compareSelect.value=selectedBaseline;
}
async function refresh(){
 const current=++request;
 feedback.textContent='Loading…';refreshButton.disabled=true;
 const target=selectedRun, comparison=selectedBaseline;
 try{
  const entries=await readJson('history.json');
  if(target&&!entries.some(x=>x.id===target))throw Error('Selected run is not in the archive');
  const next=await readJson(target?'runs/'+encodeURIComponent(target)+'.json':'latest.json');
  const matches=x=>x.id!==next.id&&x.status==='complete'&&x.method===next.method&&x.node===next.node&&x.cpu===next.cpu;
  const candidate=comparison?entries.find(x=>x.id===comparison&&matches(x)):[...entries].reverse().find(x=>matches(x)&&x.id<next.id);
  const before=candidate?await readJson('runs/'+encodeURIComponent(candidate.id)+'.json'):null;
  if(current!==request)return;
  run=next;history=entries;baseline=before;
  document.querySelector('#detail').hidden=true;
  options();paint();remember();
  feedback.textContent='Showing '+run.id.slice(0,19).replace('T',' ')+' UTC · refreshed '+new Date().toLocaleTimeString();
 }catch(error){if(current===request)feedback.textContent=error.message;}
 finally{if(current===request)refreshButton.disabled=false;}
}

const time=x=>x==null?'—':x<1000?x.toFixed(1)+' ms':x<60000?(x/1000).toFixed(2)+' s':(x/60000).toFixed(2)+' min';
const ratio=(a,b)=>baseline?.method===run.method&&baseline?.node===run.node&&baseline?.cpu===run.cpu&&a?.status==='ok'&&b?.status==='ok'&&a.workloadHash===b.workloadHash&&a.kind===b.kind&&a.ms>=100&&b.ms>=100?a.ms/b.ms:null;
const delta=x=>x==null?'—':((x-1)*100>=0?'+':'')+((x-1)*100).toFixed(1)+'%';
function paint(){
 document.querySelector('#report-header').innerHTML=headerHtml(run,esc);
 document.querySelector('#histogram').innerHTML=histogram(run);
 const old=new Map((baseline?.results||[]).map(x=>[x.path,x]));
 const counts=Object.groupBy(run.results,x=>x.status);
 document.querySelector('#cards').innerHTML=[['Progress',run.results.length+'/'+run.total],['Passed',counts.ok?.length||0],['Timeouts',counts.timeout?.length||0],['Errors',(counts.error?.length||0)+(counts['memory-limit']?.length||0)]].map(([k,v])=>'<div class="card"><strong>'+v+'</strong>'+k+'</div>').join('');
 const grouped=Object.groupBy(run.results,x=>x.group);
 document.querySelector('#groups').innerHTML='<tr><th>Group</th><th>OK / total</th><th>Elapsed</th><th>Matched</th><th>Change</th></tr>'+Object.entries(grouped).sort().map(([name,rows])=>{const ratios=rows.map(x=>ratio(x,old.get(x.path))).filter(x=>x!=null);const r=ratios.length?Math.exp(ratios.reduce((n,x)=>n+Math.log(x),0)/ratios.length):null;return '<tr><td>'+esc(name)+'</td><td>'+rows.filter(x=>x.status==='ok').length+'/'+rows.length+'</td><td>'+time(rows.reduce((n,x)=>n+(x.ms||0),0))+'</td><td>'+ratios.length+'</td><td>'+delta(r)+'</td></tr>'}).join('');
 const query=document.querySelector('#query').value.toLowerCase(),status=document.querySelector('#status').value;
 const rows=run.results.filter(x=>x.path.toLowerCase().includes(query)&&(!status||x.status===status)).sort((a,b)=>direction*(typeof a[sort]==='string'?a[sort].localeCompare(b[sort]):(a[sort]||0)-(b[sort]||0)));
 document.querySelector('#rows').innerHTML=rows.map(x=>{const b=old.get(x.path),r=ratio(x,b);return '<tr><td><a href="#detail" data-path="'+esc(x.path)+'">'+esc(x.path.replace('demos/',''))+'</a></td><td>'+x.kind+'</td><td class="'+(x.status==='ok'?'good':'bad')+'">'+x.status+'</td><td class="num">'+time(x.ms)+'</td><td class="num">'+time(b?.ms)+'</td><td class="num '+(r>1.1?'bad':r<0.9&&r!=null?'good':'')+'">'+(b&&b.workloadHash!==x.workloadHash?'source changed':delta(r))+'</td></tr>'}).join('');
}
for(const id of ['query','status'])document.getElementById(id).addEventListener('input',()=>{paint();remember()});
document.querySelectorAll('[data-sort]').forEach(x=>x.onclick=()=>{direction=sort===x.dataset.sort?-direction:1;sort=x.dataset.sort;paint()});
runSelect.onchange=()=>{selectedRun=runSelect.value;selectedBaseline='';return refresh();};
compareSelect.onchange=()=>{selectedBaseline=compareSelect.value;return refresh();};
refreshButton.onclick=()=>refresh();
document.querySelector('#rows').onclick=async e=>{const path=e.target.dataset.path;if(!path)return;e.preventDefault();const row=run.results.find(x=>x.path===path);const panel=document.querySelector('#detail');panel.hidden=false;panel.innerHTML='<h3>'+esc(path)+'</h3><p>'+esc(row.workload)+' · '+time(row.ms)+(row.cpuMs==null?'':' · CPU '+time(row.cpuMs))+(row.peakRssMiB==null?'':' · peak RSS '+row.peakRssMiB.toFixed(1)+' MiB')+'</p><pre>'+esc(row.log)+'</pre><p id="trend">Loading history…</p>';
 try {const samples=await Promise.all(history.filter(h=>h.method===run.method&&h.node===run.node&&h.cpu===run.cpu&&(h.status==='complete'||h.id===run.id)).slice(-20).map(async h=>{const data=await fetch('metrics/'+h.id+'.json').then(r=>r.json());return {id:h.id,commit:h.commit,row:data.find(x=>x.path===path)}}));const points=samples.map((x,i)=>({x:i,y:x.row?.status==='ok'?x.row.ms:null})).filter(x=>x.y!=null);const max=Math.max(1,...points.map(x=>x.y));const coords=points.map(p=>(20+p.x*560/Math.max(1,samples.length-1)).toFixed(1)+','+(140-p.y/max*120).toFixed(1)).join(' ');const chart='<svg viewBox="0 0 600 160" style="max-width:600px;width:100%" role="img" aria-label="Recent execution times"><line x1="20" y1="140" x2="580" y2="140" stroke="#475569"/><polyline points="'+coords+'" fill="none" stroke="#8cc8ff" stroke-width="3"/>'+points.map(p=>'<circle cx="'+(20+p.x*560/Math.max(1,samples.length-1))+'" cy="'+(140-p.y/max*120)+'" r="4" fill="#80dfb1"/>').join('')+'</svg><br>';document.querySelector('#trend').innerHTML=chart+samples.map(x=>'<span title="'+esc(x.commit)+'">'+esc(x.id.slice(0,10))+': '+time(x.row?.ms)+' ('+esc(x.row?.status||'missing')+')</span>').join('<br>')}catch{document.querySelector('#trend').textContent='History unavailable';}};
fetch('job.json').then(r=>r.json()).then(x=>{document.querySelector('#job').textContent='Nightly job: '+(x.phase||('exit '+x.exitCode))+' · '+(x.updated||x.finished)}).catch(()=>{});
paint();
refresh();
setInterval(()=>{
 if(run.status==='running'&&!document.hidden&&!refreshButton.disabled&&document.querySelector('#detail').hidden)refresh();
},60000);
</script></html>`;
}
