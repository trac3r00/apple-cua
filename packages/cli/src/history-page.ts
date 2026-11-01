/** Local-only history review surface. Evidence and model output are always rendered as text. */
export function historyPage(): string {
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Computer history | apple-cua</title>
<style>
:root{color-scheme:light dark;--bg:#f5f5f7;--panel:#fff;--text:#1d1d1f;--muted:#56565c;--line:#86868b;--action:#0066cc;--on-action:#fff;--error:#ad2020;--radius:8px;--space:16px}
@media(prefers-color-scheme:dark){:root{--bg:#171719;--panel:#262629;--text:#f5f5f7;--muted:#c4c4ca;--line:#8d8d94;--action:#8bc5ff;--on-action:#111;--error:#ffabab}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
header{padding:24px 32px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;gap:var(--space);flex-wrap:wrap}
h1{font-size:26px;line-height:1.2;margin:0}h2{font-size:19px;margin:0 0 16px}p{margin:8px 0 16px}small,.muted{color:var(--muted)}
main{max-width:1280px;margin:auto;display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);gap:32px;padding:32px}
section,aside{min-width:0}.panel{background:var(--panel);padding:24px;border-radius:var(--radius)}
button,input,textarea{font:inherit;color:inherit}button{min-height:44px;padding:9px 16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);cursor:pointer}
button:hover{filter:brightness(.94)}button:active{filter:brightness(.88)}button:disabled{opacity:.55;cursor:default}
button{max-width:100%;overflow-wrap:anywhere}button.primary{background:var(--action);color:var(--on-action);border-color:var(--action)}
:focus-visible{outline:3px solid var(--action);outline-offset:3px}input,textarea{width:100%;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:10px}
textarea{resize:vertical;min-height:100px}label{display:block;margin:16px 0 6px}input[type=checkbox]{width:20px;height:20px;flex:none}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.consent{display:flex;align-items:flex-start;gap:12px}
#timeline{list-style:none;padding:0;margin:16px 0}#timeline li{border-bottom:1px solid var(--line);padding:14px 0}
#timeline label{display:flex;gap:12px;align-items:flex-start;margin:0;cursor:pointer;min-height:44px}
.entry-text{min-width:0;overflow-wrap:anywhere}.entry-text strong{display:block}
#status{min-height:24px;overflow-wrap:anywhere}#status.error{color:var(--error)}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.6 ui-monospace,monospace;max-height:360px;overflow:auto}
#summary,#digests p{white-space:pre-wrap;overflow-wrap:anywhere}#draft-body{min-height:300px;font:13px/1.6 ui-monospace,monospace}
.stack{display:grid;gap:24px}.hidden,[hidden]{display:none!important}
@media(max-width:720px){header{padding:20px}main{grid-template-columns:minmax(0,1fr);padding:20px;gap:24px}.panel{padding:20px}}
</style></head><body>
<header><div><h1>Computer history</h1><small>apple-cua</small></div><div class="row"><span id="recording-state">Reading recorder state...</span><button id="refresh">Refresh</button><button id="close">Close history</button></div></header>
<main><aside><h2>Recent activity</h2><label for="filter">Find an app or time</label><input id="filter" type="search" placeholder="Search recorded sessions">
<p class="muted">Select up to 12 recorded segments. Raw activity expires; saved summaries and skills remain.</p>
<ul id="timeline"><li>Loading activity...</li></ul></aside>
<section class="stack"><div class="panel"><h2>Record a skill</h2>
<p>Start a focused demonstration, perform the workflow, then stop to select only that activity. The history recorder must already be running.</p>
<div class="row"><button id="record-start">Start demonstration</button><button id="record-stop" hidden>Stop demonstration</button></div>
<p id="record-status" role="status">Background history recording is controlled separately.</p>
</div><div class="panel"><h2>Review a workflow</h2>
<p>Turn selected activity into a summary or a reusable skill. Inspect what will be shared before generating.</p>
<div class="row"><button id="preview">Preview selected evidence</button><button id="summarize">Summarize</button></div>
<details id="evidence-box" hidden><summary>Selected evidence</summary><pre id="evidence"></pre></details>
<label for="intent">What should this skill accomplish?</label><textarea id="intent" maxlength="2000" placeholder="For example: format a monthly report in Word"></textarea>
<label class="consent"><input id="consent" type="checkbox"><span>Send selected evidence to my configured OmO model. Typed text, selection text and accessibility values are omitted; app and window labels may still contain private information.</span></label>
<p class="muted">The model receives no tools. A draft is not a verified replay: review its steps and test it on a disposable document.</p>
<button id="draft" class="primary">Create skill draft</button>
<p id="status" role="status" aria-live="polite"></p>
</div>
<div class="panel" id="summary-box" hidden><h2>Activity summary</h2><div id="summary"></div></div>
<form class="panel" id="review" hidden><h2>Review skill</h2>
<label for="draft-name">Skill name</label><input id="draft-name" required pattern="[a-z0-9-]+" maxlength="64">
<label for="draft-description">When should an agent use it?</label><textarea id="draft-description" required maxlength="1024"></textarea>
<label for="draft-body">Instructions</label><textarea id="draft-body" required maxlength="24000"></textarea>
<p class="muted">Saving creates a new SKILL.md in your local agent skills directory. Existing skills are never replaced.</p>
<button type="submit" class="primary" id="save">Save reviewed skill</button><p id="saved" role="status"></p>
</form><div class="panel"><h2>Workflow suggestions</h2>
<label class="consent"><input id="automation" type="checkbox"><span>Automatically send completed activity to my configured OmO model for summaries and skill suggestions. This uses model tokens while the recorder is running.</span></label>
<p id="automation-status" class="muted"></p><div id="digests"></div>
</div><div class="panel"><h2>Saved summaries</h2><div id="summaries"><p class="muted">Loading saved summaries...</p></div></div></section></main>
<script>
const byId=id=>document.getElementById(id);
let entries=[];
let busy=false;
let recordingId;
let demonstrationId;
let suggestionId;
let suggestionSourceIds=[];
const selected=()=>Array.from(document.querySelectorAll('#timeline input:checked')).map(input=>input.value);
const selectionInput=()=>({ids:suggestionId?suggestionSourceIds:selected(),...(demonstrationId?{demonstrationId}: {}),...(suggestionId?{digestId:suggestionId}: {})});
function status(text,error=false){byId('status').textContent=text;byId('status').classList.toggle('error',error)}
function clearEvidence(){byId('evidence').textContent='';byId('evidence-box').hidden=true}
async function api(action,body){
 const response=await fetch('./api/'+action,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed');return result;
}
function draw(){
 clearEvidence();
 const previous=new Set(selected());const list=byId('timeline');list.replaceChildren();
 const query=byId('filter').value.toLowerCase();
 const filtered=entries.filter(entry=>(entry.apps.join(' ')+' '+entry.startedAt).toLowerCase().includes(query));
 if(!filtered.length){const li=document.createElement('li');li.textContent=entries.length?'No matching activity.':'No recorded activity yet. Start recording from the apple-cua menu, then return here.';list.append(li)}
 for(const entry of filtered){
  const li=document.createElement('li'),label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('small');
  input.type='checkbox';input.value=entry.id;input.checked=previous.has(entry.id);input.onchange=()=>{demonstrationId=undefined;suggestionId=undefined;clearEvidence()};
  span.className='entry-text';strong.textContent=entry.apps.join(', ')||'Desktop session';
  small.textContent=new Date(entry.startedAt).toLocaleString()+' | '+entry.eventCount+' events';
  span.append(strong,small);label.append(input,span);li.append(label);list.append(li);
 }
}
async function run(action){
 if(busy)return;busy=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);
 try{await action()}catch(error){status(error instanceof Error?error.message:'Request failed',true)}
 finally{busy=false;document.querySelectorAll('button').forEach(button=>button.disabled=button.dataset.unavailable==='true')}
}
async function refreshSummaries(){const data=await api('summaries');const list=byId('summaries');list.replaceChildren();if(!data.summaries.length){const p=document.createElement('p');p.className='muted';p.textContent='No saved summaries yet.';list.append(p)}for(const item of data.summaries){const details=document.createElement('details'),heading=document.createElement('summary'),body=document.createElement('pre');heading.textContent=new Date(Number(item.id.split('-')[0])).toLocaleString();body.textContent=item.summary;details.append(heading,body);list.append(details)}}
async function refreshAutomation(){
 const settings=await api('automation');byId('automation').checked=settings.enabled;
 byId('automation-status').textContent=settings.enabled?'Enabled. The recorder checks each 10-minute window. Last result: '+settings.status:'Automatic model sharing is off.';
 const data=await api('digests'),list=byId('digests');list.replaceChildren();
 if(!data.digests.length){const p=document.createElement('p');p.className='muted';p.textContent='No generated suggestions yet.';list.append(p)}
 for(const item of data.digests){const section=document.createElement('section'),title=document.createElement('h3'),summary=document.createElement('p');title.textContent=item.title;summary.textContent=item.summary;section.append(title,summary);
  if(item.suggestion){const button=document.createElement('button');button.textContent='Create skill: '+item.suggestion.name;button.onclick=()=>{byId('filter').value='';draw();demonstrationId=undefined;suggestionId=item.id;suggestionSourceIds=item.sourceIds;document.querySelectorAll('#timeline input').forEach(input=>{input.checked=item.sourceIds.includes(input.value)});byId('intent').value=item.suggestion.goal;byId('intent').scrollIntoView({block:'center'});byId('intent').focus();status('Using this saved summary, not the raw event stream. Preview it, enable sharing, then create a draft.')};section.append(button)}
  list.append(section);
 }
}
async function refresh(){const data=await api('timeline');entries=data.entries;byId('recording-state').textContent='Recorder: '+data.state;byId('record-start').dataset.unavailable=String(data.state!=='running');if(!recordingId&&!demonstrationId)byId('record-status').textContent=data.state==='running'?'Ready to record a focused demonstration.':'Start or resume the recorder from the apple-cua menu before demonstrating.';draw();await refreshSummaries();await refreshAutomation()}
function generationInput(){
 const ids=selectionInput().ids;if(!ids.length)throw new Error('Select recorded activity or a saved suggestion first.');
 if(ids.length>12)throw new Error('Select no more than 12 segments.');
 if(!byId('consent').checked)throw new Error('Review and enable model sharing before generating.');
 return {...selectionInput(),instruction:byId('intent').value,consent:true};
}
byId('record-start').onclick=()=>run(async()=>{const data=await api('record/start',{});recordingId=data.id;demonstrationId=undefined;suggestionId=undefined;byId('record-start').hidden=true;byId('record-stop').hidden=false;byId('record-status').textContent='Demonstrating since '+new Date(data.startedAt).toLocaleTimeString()+'. Return here and stop when the workflow is complete.'});
byId('record-stop').onclick=()=>run(async()=>{const data=await api('record/stop',{id:recordingId});await refresh();byId('filter').value='';draw();document.querySelectorAll('#timeline input').forEach(input=>{input.checked=data.sourceIds.includes(input.value)});demonstrationId=data.id;recordingId=undefined;byId('record-start').hidden=false;byId('record-stop').hidden=true;byId('record-status').textContent='Demonstration selected. Review its evidence and create a draft below. Background recording continues.';byId('intent').scrollIntoView({block:'center'});byId('intent').focus()});
byId('automation').onchange=()=>run(async()=>{await api('automation',{enabled:byId('automation').checked});await refreshAutomation()});
byId('filter').addEventListener('input',draw);
byId('refresh').onclick=()=>run(refresh);
byId('preview').onclick=()=>run(async()=>{const data=await api('evidence',selectionInput());byId('evidence').textContent=data.evidence;byId('evidence-box').hidden=false;byId('evidence-box').open=true;status('Review the selected evidence before sharing.')});
byId('summarize').onclick=()=>run(async()=>{const input=generationInput();status('Generating summary...');const data=await api('summarize',input);byId('summary').textContent=data.summary;byId('summary-box').hidden=false;await refreshSummaries();status('Summary saved locally.')});
byId('draft').onclick=()=>run(async()=>{const input=generationInput();status('Generating skill draft...');const data=await api('draft',input);byId('draft-name').value=data.name;byId('draft-description').value=data.description;byId('draft-body').value=data.body;byId('review').hidden=false;byId('saved').textContent='';byId('draft-name').focus();status('Draft ready. Review every step before saving.')});
byId('review').onsubmit=event=>{event.preventDefault();run(async()=>{const data=await api('save',{name:byId('draft-name').value,description:byId('draft-description').value,body:byId('draft-body').value});byId('saved').textContent='Saved: '+data.path;status('Skill saved. Ask your agent to use it on a disposable example before relying on it.')})};
byId('close').onclick=()=>run(async()=>{await api('close',{});document.body.replaceChildren();const p=document.createElement('p');p.textContent='History closed. Recording continues independently. You can close this tab.';document.body.append(p)});
run(async()=>{await refresh();if(new URLSearchParams(location.search).has('record'))byId('record-start').focus()});
</script></body></html>`;
}
