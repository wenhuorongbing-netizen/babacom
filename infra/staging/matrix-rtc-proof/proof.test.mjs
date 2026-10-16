import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { validateContract, SafeEvents, httpRequest, transaction, assertOwned, assertResources, assertTicket, assertParticipants, redirectGuard, Budget, PINS, OPENID_HELPER, startExperiment, stopOwned, serverName, templateValues, assertMembershipDenial, command } from './proof.mjs';

function contract() {
  return { host: 'lhins-af0ntal8', root: '/opt/babacom-matrix-rtc-e1', project: 'babacom-matrix-rtc-e1',
    runId: 'a'.repeat(32), domain: 'rtc.example.org', port: 18443, certificateSource: 'operator-provisioned-public-chain',
    approved: true, logAdmission: true, machineUuid:'machine', fullAccessHomeservers: ['rtc.example.org:18443'], asHomeserver: 'rtc.example.org:18443',
    platform: 'linux/amd64', source: PINS, sourceHashes: Object.fromEntries(['compose.yaml','homeserver.yaml.example','appservice-registration.yaml.example','livekit.yaml.example','Caddyfile','proof.mjs','proof.test.mjs'].map(name=>[name,'f'.repeat(64)])), auxiliary: { cgroup: '/sys/fs/cgroup/rtc-r0', cpu: .1, memory: 134217728 },
    thresholds: { minFreeMemory: 2000000000, minFreeDisk: 3000000000, maxLoad: 2, maxOldCpuPercent: 80, maxOldMemoryGrowth: 100000000 },
    baseline: [{ id: 'b'.repeat(64), image: 'sha256:' + 'c'.repeat(64), status: 'running', mounts: [] }],
    accessors: ['operator-loopback'], certificateSha256: 'd'.repeat(64) };
}
test('contract has no domain, port, certificate, baseline, thresholds, log or authority fallback', () => {
  assert.doesNotThrow(() => validateContract(contract()));
  for (const key of ['domain','port','certificateSource','certificateSha256','baseline','thresholds','logAdmission','approved','auxiliary','source','sourceHashes']) {
    const c = contract(); delete c[key]; assert.throws(() => validateContract(c), undefined, key);
  }
  for (const change of [{ port: 0 }, { fullAccessHomeservers: ['*'] }, { asHomeserver: 'other.example.org' }, { fullAccessHomeservers: ['rtc.example.org','other'] }, { domain: 'https://rtc.example.org' }, { platform: 'linux/arm64' }]) assert.throws(() => validateContract({ ...contract(), ...change }));
});

test('startup shares the public deadline through delayed Docker preflight and supervisor dispatch', async () => {
  let now=0,dispatched=false,cleaned=false;const budget=new Budget(120000,()=>now);
  const io={preflight:async(_c,b)=>{assert.equal(b.remaining(),120000);now+=100000;},launch:async(_c,b)=>{dispatched=true;assert.equal(b.remaining(),20000);return b.end;},status:async(_c,b)=>{now+=21000;b.remaining();},recover:async()=>{cleaned=true;}};
  await assert.rejects(startExperiment(contract(),budget,io),/DEADLINE/);assert.equal(dispatched,true);assert.equal(cleaned,true);assert.equal(now,121000);
});

test('waitFor checks the deadline even if its predicate is already true', async () => {
  let now=0;const budget=new Budget(10,()=>now);now=11;await assert.rejects(budget.waitFor(()=>true),/DEADLINE/);
});
test('BUSY before a new supervisor launches never stops an existing experiment',async()=>{
  let stopped=false;await assert.rejects(startExperiment(contract(),new Budget(1000),{preflight:async()=>{throw Error('BUSY');},launch:async()=>{throw Error('must not launch');},recover:async()=>{stopped=true;}}),/BUSY/);assert.equal(stopped,false);
});

function receipt(c){return {version:1,host:c.host,machineUuid:'machine',project:c.project,runId:c.runId,containers:['synapse','livekit','auth','caddy'].map((service,n)=>({service,id:String(n+1).repeat(64),image:PINS[service].image,imageId:'sha256:'+String(n+5).repeat(64),created:'2026-10-16T00:00:00Z'}))};}
function inspected(c,row){return {Id:row.id,Image:row.imageId,Created:row.created,State:{Running:true},Config:{Image:row.image,Labels:{'com.docker.compose.project':c.project,'com.docker.compose.service':row.service,'rtc.run':c.runId,'rtc.host':c.host}}};}
test('recovery ignores stale supervisor PID/socket and stops only receipt-owned resources with fresh checks', async () => {
  const c=contract(),r=receipt(c);let now=0;const stopped=[];const states=new Map(r.containers.map(x=>[x.id,inspected(c,x)]));states.get(r.containers[1].id).Config.Labels['rtc.run']='another-run';
  const io={machine:()=>r.machineUuid,inspect:async(id,b)=>{b.remaining();return structuredClone(states.get(id));},stop:async(id,b)=>{b.remaining();stopped.push(id);states.get(id).State.Running=false;}};
  const result=await stopOwned(c,r,new Budget(60000,()=>now),io);assert.equal(result,'UNKNOWN');assert.equal(stopped.length,3);assert.equal(stopped.includes(r.containers[1].id),false);
  assert.equal(states.get(r.containers[1].id).State.Running,true);
});
test('slow Docker inspections exhaust one stop deadline without starting late mutations', async () => {
  const c=contract(),r=receipt(c);let now=0;const states=new Map(r.containers.map(x=>[x.id,inspected(c,x)]));const stopped=[];
  const io={machine:()=>r.machineUuid,inspect:async(id,b)=>{now+=9000;b.remaining();return structuredClone(states.get(id));},stop:async(id,b)=>{b.remaining();stopped.push(id);states.get(id).State.Running=false;}};
  const result=await stopOwned(c,r,new Budget(60000,()=>now),io);assert.equal(result,'DEADLINE');assert.ok(now<=63000);assert.equal(stopped.length,3);
});
test('wrong host, run, project, configured image, actual image and created identity prevent cleanup mutation', async()=>{
  const c=contract(),r=receipt(c);
  for(const change of [{host:'other'},{runId:'other'},{project:'other'},{machineUuid:'other'}]){let mutated=false;const result=await stopOwned(c,{...r,...change},new Budget(1000),{machine:()=>r.machineUuid,inspect:async()=>{throw Error('must not inspect');},stop:async()=>{mutated=true;}});assert.equal(result,'UNKNOWN');assert.equal(mutated,false);}
  for(const field of ['Image','Created']){let mutated=0;const result=await stopOwned(c,r,new Budget(1000),{machine:()=>r.machineUuid,inspect:async id=>({...inspected(c,r.containers.find(x=>x.id===id)),[field]:'other'}),stop:async()=>{mutated++;}});assert.equal(result,'UNKNOWN');assert.equal(mutated,0);}
});
test('rendered internal route, published route, Matrix authority and TLS name remain consistent',()=>{
  const c=contract(),values=templateValues(c,{}),render=text=>text.replace(/\{\{([A-Z_]+)\}\}/g,(_,key)=>values[key]??'synthetic');
  assert.equal(serverName(c),'rtc.example.org:18443');
  const hs=render(fs.readFileSync(new URL('./homeserver.yaml.example',import.meta.url),'utf8'));assert.ok(hs.includes('server_name: "rtc.example.org:18443"'));
  const as=render(fs.readFileSync(new URL('./appservice-registration.yaml.example',import.meta.url),'utf8'));assert.ok(as.includes('rtc\\.example\\.org:18443$'));
  const caddy=render(fs.readFileSync(new URL('./Caddyfile',import.meta.url),'utf8'));assert.ok(caddy.includes('https://rtc.example.org:18443'));assert.equal(caddy.includes('rtc.example.org:443'),false);
  const compose=fs.readFileSync(new URL('./compose.yaml',import.meta.url),'utf8');assert.ok(compose.includes('LIVEKIT_FULL_ACCESS_HOMESERVERS: ${RTC_DOMAIN:?approved domain required}:${RTC_PORT:?approved port required}'));assert.ok(compose.includes('LIVEKIT_HS_SERVER_NAME: ${RTC_DOMAIN:?approved domain required}:${RTC_PORT:?approved port required}'));assert.ok(compose.includes(':${RTC_PORT:?approved exact loopback port required}'));
});
test('valid-identity membership denials require observed 403/M_FORBIDDEN; authentication/network failures cannot pass',()=>{
  assert.deepEqual(assertMembershipDenial({status:403,body:Buffer.from('{"errcode":"M_FORBIDDEN"}')}),{status:403,errcode:'M_FORBIDDEN'});
  for(const [status,body] of [[401,{errcode:'M_UNAUTHORIZED'}],[403,{errcode:'M_UNAUTHORIZED'}],[502,{errcode:'M_FORBIDDEN'}],[403,{errcode:'M_FORBIDDEN',jwt:'bad'}]])assert.throws(()=>assertMembershipDenial({status,body:Buffer.from(JSON.stringify(body))}));
});

test('recovery works after actual supervisor SIGKILL through delayed process-backed Docker fixtures', {timeout:10000}, async()=>{
  const controller=spawn(process.execPath,['-e',"process.stdout.write('ready');setInterval(()=>{},1000);"],{stdio:['ignore','pipe','pipe']});await once(controller.stdout,'data');controller.kill('SIGKILL');const [code,signal]=await once(controller,'close');assert.ok(code!==0||signal);
  const c=contract(),r=receipt(c),states=new Map(r.containers.map(row=>[row.id,inspected(c,row)])),stopped=[];
  const delayed=async(value,budget)=>JSON.parse(await command(process.execPath,['-e',`setTimeout(()=>process.stdout.write(${JSON.stringify(JSON.stringify(value))}),20);`],{budget}));
  const io={machine:()=>r.machineUuid,inspect:(id,budget)=>delayed(states.get(id),budget),stop:async(id,budget)=>{await delayed({status:'stopped'},budget);stopped.push(id);states.get(id).State.Running=false;}};
  assert.equal(await stopOwned(c,r,new Budget(5000),io),'OK');assert.equal(stopped.length,4);assert.ok([...states.values()].every(i=>!i.State.Running));
});
test('actual delayed Docker child cannot outlive its inherited operation budget', {timeout:3000}, async()=>{
  const start=performance.now();await assert.rejects(command(process.execPath,['-e',"setTimeout(()=>process.stdout.write('late'),1000);"],{budget:new Budget(40)}),/DEADLINE/);assert.ok(performance.now()-start<500);
});
test('unknown log chunks never pass through; split/encoded secrets only become counters', () => {
  const lines = []; const events = new SafeEvents(value => lines.push(value));
  for (const chunk of ['access_tok','en=incapable%2Fsentinel\n', '{"error":"secret\\u002Fvalue"}\n', 'http://user:password@host\n', 'x'.repeat(100000)]) events.consume('auth', Buffer.from(chunk));
  events.event('auth', 'http', 401, 'M_FORBIDDEN', 1);
  events.event('auth', 'secret', 200, 'secret', 1);
  assert.equal(lines.length, 2);
  assert.equal(JSON.stringify(lines).includes('secret'), false);
  assert.equal(JSON.stringify(lines).includes('sentinel'), false);
  assert.equal(lines[1].event, 'unknown');
  assert.ok(events.bytes > 100000);
});
test('ownership excludes another run, image, host and project', () => {
  const c=contract(); const i={ Id:'e'.repeat(64), Config:{ Image:PINS.auth.image, Labels:{ 'com.docker.compose.project':c.project, 'rtc.run':c.runId, 'rtc.host':c.host, 'com.docker.compose.service':'auth' } } };
  assert.doesNotThrow(() => assertOwned(i,c,'auth'));
  for (const key of ['rtc.run','rtc.host','com.docker.compose.project']) { const copy=structuredClone(i); copy.Config.Labels[key]='wrong'; assert.throws(() => assertOwned(copy,c,'auth')); }
  i.Config.Image='other'; assert.throws(() => assertOwned(i,c,'auth'));
});
test('actual cgroups include verifier and reject unlimited, missing and aggregate excess', () => {
  const rows=[{cpu:.4,memory:500000000},{cpu:.4,memory:500000000},{cpu:.1,memory:134217728}];
  assert.doesNotThrow(() => assertResources(rows));
  for (const bad of [[...rows,{cpu:.2,memory:1}],[...rows,{cpu:.01,memory:1000000000}],[{cpu:0,memory:1}],[{cpu:1,memory:0}],[]]) assert.throws(() => assertResources(bad));
});
test('request classifies HTTP denial separately and never follows a redirect', async () => {
  let destination=0; const server=http.createServer((req,res)=>{ if(req.url==='/destination') destination++; res.writeHead(req.url==='/deny'?403:302,{Location:'/destination',Refresh:'0; /destination'}); res.end('sensitive'); });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  try { const base=`http://127.0.0.1:${server.address().port}`; assert.equal((await httpRequest(base+'/deny',{allowHttpFixture:true})).status,403); assert.equal((await httpRequest(base+'/redirect',{allowHttpFixture:true})).status,302); assert.equal(destination,0); } finally { server.close(); }
});
test('every 3xx is replaced without upstream body or headers', () => {
  for(let status=300;status<400;status++) assert.deepEqual(redirectGuard({status,headers:{Location:'secret',Refresh:'secret'},body:Buffer.from('secret')}),{status:502,headers:{},body:Buffer.from('')});
});
test('8 second supervisor deadline requires actual exit, attach end and upstream close', async () => {
  let killed=0;
  const result=await transaction(async()=>new Promise(()=>{}),async()=>{killed++;return {exit:true,attachEnd:true,upstreamClosed:true};},{timeout:35,limit:100});
  assert.equal(result.status,'FAIL'); assert.equal(result.termination,'PROVED'); assert.equal(killed,1);
  const unknown=await transaction(async()=>new Promise(()=>{}),async()=>({exit:true,attachEnd:false,upstreamClosed:true}),{timeout:20,limit:100});
  assert.equal(unknown.termination,'UNKNOWN');
});
test('deadline starts before sending and never resets', async () => {
  const budget=new Budget(25); await new Promise(resolve=>setTimeout(resolve,35)); assert.throws(()=>budget.remaining());
  let sent=false; await assert.rejects(transaction(async()=>{sent=true;},{},{budget})); assert.equal(sent,false);
});
test('JWT and administrative observation must agree; any track is failure', () => {
  const expected={subject:'@rtc-a:rtc.example.org:DEVICE',room:'!private:rtc.example.org',key:'key'};
  const claims={sub:expected.subject,iss:'key',exp:Math.floor(Date.now()/1000)+3600,video:{room:expected.room,roomJoin:true,canPublish:true,canSubscribe:true,canPublishData:true}};
  assert.doesNotThrow(()=>assertTicket(claims,expected));
  assert.throws(()=>assertTicket({...claims,sub:'@other'},expected));
  assert.throws(()=>assertTicket({...claims,video:{...claims.video,roomAdmin:true}},expected));
  assert.doesNotThrow(()=>assertParticipants([{identity:expected.subject,tracks:[]}],[expected.subject]));
  assert.throws(()=>assertParticipants([{identity:expected.subject,tracks:[{}]}],[expected.subject]));
  assert.throws(()=>assertParticipants([], [expected.subject]));
});

test('real Python guard caps complete responses, closes held upstream and serializes no marker', {timeout:40000}, async () => {
  let mode='ok', hits=0;const marker='incapable-secret%2Fsentinel';
  const upstream=http.createServer((req,res)=>{hits++;
    if(mode==='headers'){req.socket.write('HTTP/1.0 200 OK\r\nX-Slow: ');const timer=setInterval(()=>req.socket.write('x'),100);req.socket.once('close',()=>clearInterval(timer));}
    else if(mode==='body'||mode==='noeof'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{"sub":"@rtc-a:rtc.example.org"}');if(mode==='body'){const timer=setInterval(()=>res.write(' '),100);req.socket.once('close',()=>clearInterval(timer));}}
    else if(mode==='redirect'){res.writeHead(307,{Location:'https://secret.example.org/'+marker,Refresh:marker});res.end(marker);}else if(mode==='large'){res.end('x'.repeat(5000));}else{res.end(JSON.stringify({sub:'@rtc-a:rtc.example.org',ignored:marker}));}});
  upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
  const python=process.env.RTC_TEST_PYTHON||(process.platform==='win32'?path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe'):'python3');
  const child=spawn(python,['-u','-c',OPENID_HELPER,'0',String(upstream.address().port)],{stdio:['pipe','pipe','pipe']});
  const messages=[];let raw='',stderr='',carry='';child.stdout.on('data',b=>{raw+=b;carry+=b;let index;while((index=carry.indexOf('\n'))>=0){messages.push(JSON.parse(carry.slice(0,index)));carry=carry.slice(index+1);}});child.stderr.on('data',b=>{stderr+=b;});
  const wait=async predicate=>{const end=Date.now()+10000;while(!predicate()){assert.ok(Date.now()<end,'fixture deadline');await new Promise(r=>setTimeout(r,10));}};
  try{
    await wait(()=>messages.some(x=>x.event==='ready'));const port=messages.find(x=>x.event==='ready').port;const url=`http://127.0.0.1:${port}/_matrix/federation/v1/openid/userinfo?access_token=${marker}`;
    let r=await httpRequest(url,{allowHttpFixture:true});assert.equal(r.status,200);assert.deepEqual(JSON.parse(r.body),{sub:'@rtc-a:rtc.example.org'});assert.equal(r.body.includes(Buffer.from(marker)),false);
    mode='redirect';r=await httpRequest(url,{allowHttpFixture:true});assert.equal(r.status,502);assert.equal(r.headers.location,undefined);assert.equal(r.headers.refresh,undefined);assert.equal(r.body.length,0);
    mode='large';r=await httpRequest(url,{allowHttpFixture:true});assert.equal(r.status,504);assert.equal(r.body.length,0);
    for(mode of ['headers','body','noeof']){const began=performance.now();r=await httpRequest(url,{allowHttpFixture:true});assert.equal(r.status,504);assert.ok(performance.now()-began<8000,mode+' absolute deadline');assert.equal(r.body.length,0);}
    child.stdin.write('{"mode":"timeout"}\n');await wait(()=>messages.some(x=>x.event==='ack'));
    const started=performance.now();r=await httpRequest(url,{allowHttpFixture:true});assert.equal(r.status,504);await wait(()=>messages.some(x=>x.event==='upstreamClosed'));assert.ok(performance.now()-started<8000);
    assert.equal(messages.filter(x=>x.event==='upstreamOpen').length,1);assert.equal(messages.filter(x=>x.event==='upstreamClosed').length,1);assert.equal(messages.filter(x=>x.event==='destination').length,0);assert.equal(raw.includes(marker),false);assert.equal(stderr.includes(marker),false);assert.equal(hits,6);
  }finally{child.kill('SIGKILL');await once(child,'close');upstream.closeAllConnections();upstream.close();}
});

test('timeout termination proof observes actual process exit, attached stream end and upstream close', {timeout:5000}, async () => {
  const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const child=spawn(process.execPath,['-e',`require('net').connect(${server.address().port},'127.0.0.1');setInterval(()=>{},1000);`],{stdio:['ignore','pipe','pipe']});
  const [upstream]=await once(server,'connection');upstream.on('error',()=>{});let exit=false,attachEnd=false,upstreamClosed=false;
  child.once('exit',()=>{exit=true;});child.once('close',()=>{attachEnd=true;});upstream.once('close',()=>{upstreamClosed=true;});
  try{
    const result=await transaction(()=>new Promise(()=>{}),async()=>{child.kill('SIGKILL');const budget=new Budget(1000);while(!(exit&&attachEnd&&upstreamClosed)){budget.remaining();await new Promise(r=>setTimeout(r,5));}return {exit,attachEnd,upstreamClosed};},{timeout:35,limit:1500});
    assert.deepEqual(result,{status:'FAIL',termination:'PROVED'});
  }finally{child.kill('SIGKILL');upstream.destroy();server.close();}
});

test('public commands fail closed on unapproved local runtime and print only fixed fields', async () => {
  for(const action of ['preflight','config','up','verify','stop']){
    const child=spawn(process.execPath,[new URL('./proof.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),action],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});const [code]=await once(child,'close');assert.equal(code,1);const result=JSON.parse(output);assert.deepEqual(Object.keys(result),['service','event','errcode']);assert.ok(['HOLD','FAIL'].includes(result.errcode));
  }
});

test('static resource and log contracts are present in all four own containers', () => {
  const compose=fs.readFileSync(new URL('./compose.yaml',import.meta.url),'utf8');assert.equal((compose.match(/image: .*@sha256:[a-f0-9]{64}/g)||[]).length,4);
  for(const required of ['driver: none','memswap_limit: 288m','cpus: 0.2','core: {soft: 0, hard: 0}','read_only: true','internal: true','127.0.0.1:'])assert.ok(compose.includes(required),required);
  assert.equal(compose.includes('logging.FileHandler'),false);assert.ok(compose.includes('handlers: [stderr]'));
  const caddy=fs.readFileSync(new URL('./Caddyfile',import.meta.url),'utf8');assert.ok(caddy.includes('@redirect status 3xx'));assert.ok(caddy.includes('header -Location'));assert.ok(caddy.includes('header -Refresh'));
});
