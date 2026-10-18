import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { validateContract, SafeEvents, httpRequest, assertOwned, assertResources, assertTicket, assertParticipants, Budget, PINS, startExperiment, stopOwned, serverName, templateValues, assertMembershipDenial, command } from './proof.mjs';
import * as proof from './proof.mjs';

// Child fixtures use this same test file; no eval, script files or dependencies.
if(process.argv[2]==='--fixture'){
  const mode=process.argv[3];
  if(mode==='idle'){process.stdout.write('ready');setInterval(()=>{},1000);}
  else if(mode==='json')setTimeout(()=>process.stdout.write(process.argv[4]),20);
  else if(mode==='late')setTimeout(()=>process.stdout.write('late'),1000);
  else if(mode==='hold'){const socket=net.connect(Number(process.argv[4]),'127.0.0.1',()=>socket.write(String(process.pid)));process.stderr.write('incapable-child%2Fmarker');setInterval(()=>{},1000);}
  else if(mode==='fail'){process.stderr.write('incapable-child%2Fmarker');process.exitCode=7;}
  else if(mode==='failure-output'){try{await command(process.execPath,[fileURLToPath(import.meta.url),'--fixture','fail']);}catch(error){process.stdout.write(JSON.stringify({errcode:error.message}));}}
  else if(mode==='signal-hang'){await proof.signal(process.argv[4],'incapable-fixture',{allowWsFixture:true,identity:'@rtc-a:fixture:device',room:'fixture-room',timeout:50}).catch(()=>{});}
  else if(mode==='public-error')process.exitCode=await proof.publicCommand('stop',async()=>{throw new Error(process.argv[4]);});
  else process.exitCode=1;
}else{
test('built-in WebSocket sends Bearer header with no query and observes a real JoinResponse', async () => {
  let observed, sent = 0;
  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    observed = { url: req.url, authorization: req.headers.authorization };
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    // SignalResponse.join: JoinResponse.participant: ParticipantInfo.identity.
    const identity = Buffer.from('@rtc-a:fixture:device');
    const participant = Buffer.concat([Buffer.from([0x12, identity.length]), identity]);
    const roomName=Buffer.from('fixture-room'),room=Buffer.concat([Buffer.from([0x12,roomName.length]),roomName]);
    const join = Buffer.concat([Buffer.from([0x0a,room.length]),room,Buffer.from([0x12, participant.length]), participant]);
    const payload = Buffer.concat([Buffer.from([0x0a, join.length]), join]);
    socket.write(Buffer.concat([Buffer.from([0x82, payload.length]), payload]));
    socket.on('data', data => { if ((data[0] & 15) !== 8) sent++; socket.destroy(); });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const connection = await proof.signal(`ws://127.0.0.1:${server.address().port}`, 'incapable-fixture', { allowWsFixture: true, timeout: 500, identity: '@rtc-a:fixture:device',room:'fixture-room' });
    assert.deepEqual(observed, { url: '/rtc', authorization: 'Bearer incapable-fixture' });
    assert.equal(connection.joined, true); connection.socket.close();
    assert.equal(sent, 0);
  } finally { server.closeAllConnections(); server.close(); }
});

test('JoinResponse rejects wrong rooms, identities, tracks and malformed protobuf instead of accepting an upgrade',()=>{
  const field=(n,bytes)=>Buffer.concat([Buffer.from([n*8+2,bytes.length]),bytes]);
  const participant=field(2,Buffer.from('expected')),room=field(2,Buffer.from('room-a'));
  const response=field(1,Buffer.concat([field(1,room),field(2,participant)]));
  assert.equal(proof.assertJoin(response,'expected','room-a'),true);
  assert.throws(()=>proof.assertJoin(response,'expected','wrong-room'));
  assert.throws(()=>proof.assertJoin(response,'other','room-a'));
  const tracked=field(1,Buffer.concat([field(1,room),field(2,Buffer.concat([participant,field(4,Buffer.alloc(0))]))]));assert.throws(()=>proof.assertJoin(tracked,'expected','room-a'));
  for(const bad of [Buffer.from([10,127,1]),Buffer.from([128]),Buffer.from([0]),Buffer.alloc(1048577)])assert.throws(()=>proof.assertJoin(bad,'expected','room-a'));
});

test('participant removal retains signal track faults through final gate while allowing expected socket close',async()=>{
  for(const payload of [Buffer.from([0x32,0]),Buffer.from([0x2a,4,0x0a,2,0x22,0]),null]){
    const server=http.createServer();let peer;
    server.on('upgrade',(request,socket)=>{peer=socket;socket.on('error',()=>{});const accept=crypto.createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
      const field=(n,value)=>Buffer.concat([Buffer.from([n*8+2,value.length]),value]),join=field(1,Buffer.concat([field(1,field(2,Buffer.from('room'))),field(2,field(2,Buffer.from('identity')))]));socket.write(Buffer.concat([Buffer.from([0x82,join.length]),join]));socket.on('data',()=>socket.destroy());});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    try{
      const connection=await proof.signal(`ws://127.0.0.1:${server.address().port}`,'incapable-fixture',{allowWsFixture:true,identity:'identity',room:'room',timeout:1000}),connections=[connection];let gate=false;
      const remove=async()=>{const closed=once(connection.socket,'close');peer.write(payload?Buffer.concat([Buffer.from([0x82,payload.length]),payload]):Buffer.from([0x88,0]));await closed;};
      const result=proof.retireParticipants(connections,['identity'],remove,async()=>[]).then(()=>{for(const current of connections)current.assertClean();gate=true;});
      if(payload){await assert.rejects(result,/SIGNAL/);assert.equal(gate,false);assert.throws(()=>connection.assertClean(),/SIGNAL/);}else{await result;assert.equal(gate,true);}
      assert.equal(connections.length,1);
    }finally{peer?.destroy();server.close();}
  }
});

async function leaveFixture(identity='identity'){
  const server=http.createServer();let peer;
  server.on('upgrade',(request,socket)=>{peer=socket;socket.on('error',()=>{});const accept=crypto.createHash('sha1').update(request.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    const field=(n,value)=>Buffer.concat([Buffer.from([n*8+2,value.length]),value]),join=field(1,Buffer.concat([field(1,field(2,Buffer.from('room'))),field(2,field(2,Buffer.from(identity)))]));socket.write(Buffer.concat([Buffer.from([0x82,join.length]),join]));socket.on('data',()=>socket.destroy());});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const close=async()=>{peer?.destroy();await new Promise(resolve=>server.close(resolve));};let connection;
  try{connection=await proof.signal(`ws://127.0.0.1:${server.address().port}`,'incapable-fixture',{allowWsFixture:true,identity,room:'room',timeout:1000});}catch(error){await close();throw error;}
  return {connection,send:async payload=>{const closed=once(connection.socket,'close');peer.write(Buffer.concat([Buffer.from([0x82,payload.length]),payload,Buffer.from([0x88,0])]));await closed;},close};
}
test('stock LeaveRequest is accepted only after that participant removal starts',async()=>{
  for(const payload of [Buffer.from([0x42,0]),Buffer.from([0x42,2,0x10,0])]){
    const fixture=await leaveFixture();try{await proof.retireParticipants([fixture.connection],['identity'],()=>fixture.send(payload),async()=>[]);assert.doesNotThrow(()=>fixture.connection.assertClean());}finally{await fixture.close();}
  }
});
test('unexpected and malformed LeaveRequest permanently fault a joined connection',async()=>{
  for(const [expected,payload] of [[false,Buffer.from([0x42,0])],[true,Buffer.from([0x40,0])],[true,Buffer.from([0x42,1,0x80])],[true,Buffer.from([0x42,2,0x10])]]){
    const fixture=await leaveFixture();try{if(expected)fixture.connection.expectRemoval();await fixture.send(payload);assert.throws(()=>fixture.connection.assertClean(),/SIGNAL/);}finally{await fixture.close();}
  }
});
test('removing one participant cannot authorize LeaveRequest on a participant whose removal has not started',async()=>{
  const first=await leaveFixture('first'),second=await leaveFixture('second');
  try{await assert.rejects(proof.retireParticipants([first.connection,second.connection],['first','second'],async identity=>{if(identity==='first'){await second.send(Buffer.from([0x42,0]));assert.throws(()=>second.connection.assertClean(),/SIGNAL/);await first.send(Buffer.from([0x42,0]));}},async()=>[]),/SIGNAL/);assert.throws(()=>second.connection.assertClean(),/SIGNAL/);}finally{await first.close();await second.close();}
});

test('public stop cannot accept an active unit or surviving worker and cleanup controller',()=>{
  assert.equal(typeof proof.assertUnitStopped,'function');
  for(const ActiveState of ['inactive','failed'])assert.doesNotThrow(()=>proof.assertUnitStopped({ActiveState,MainPID:'0',ControlPID:'0'}));
  for(const state of [{ActiveState:'active',MainPID:'0',ControlPID:'0'},{ActiveState:'inactive',MainPID:'123',ControlPID:'0'},{ActiveState:'inactive',MainPID:'0',ControlPID:'123'},{}])assert.throws(()=>proof.assertUnitStopped(state));
});

test('actual container bindings and mounts reject another project, public ports, raw log paths and old business mounts',()=>{
  assert.equal(typeof proof.assertContainerConfiguration,'function');
  const c=contract(),row=receipt(c).containers.find(x=>x.service==='caddy'),i=inspected(c,row);
  i.HostConfig={LogConfig:{Type:'none'},ReadonlyRootfs:true,CapDrop:['ALL'],CapAdd:[],Privileged:false,NetworkMode:c.project+'_isolated',PortBindings:{'18443/tcp':[{HostIp:'127.0.0.1',HostPort:'18443'}]}};
  i.LogPath='';i.Mounts=['Caddyfile','tls.crt','tls.key'].map(name=>({Type:'bind',Source:c.root+'/secrets/'+name,Destination:'/run/secrets/'+name,RW:false}));
  assert.doesNotThrow(()=>proof.assertContainerConfiguration(i,c,'caddy'));
  for(const change of [copy=>copy.HostConfig.PortBindings['18443/tcp'][0].HostIp='0.0.0.0',copy=>copy.Mounts[0].Source='/opt/business/config',copy=>copy.LogPath='/var/log/unsafe.log',copy=>copy.HostConfig.NetworkMode='host',copy=>copy.Mounts[0].RW=true]){const copy=structuredClone(i);change(copy);assert.throws(()=>proof.assertContainerConfiguration(copy,c,'caddy'));}
});

test('a WebSocket peer that ignores close cannot keep a bounded child alive',async()=>{
  const server=http.createServer(),sockets=new Set();let closed=false;
  server.on('upgrade',(req,socket)=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>{closed=true;sockets.delete(socket);});const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.on('data',()=>{});});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{await assert.rejects(command(process.execPath,[fileURLToPath(import.meta.url),'--fixture','signal-hang',`ws://127.0.0.1:${server.address().port}`],{budget:new Budget(1000)}),/DEADLINE/);await new Budget(500).waitFor(()=>closed);}
  finally{for(const socket of sockets)socket.destroy();server.close();}
});

test('built-in WebSocket retains strict default TLS and rejects a server without a trusted certificate', async () => {
  const server = tls.createServer(); server.on('tlsClientError', () => {});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try { await assert.rejects(proof.signal(`wss://127.0.0.1:${server.address().port}`, 'incapable-fixture', { timeout: 500, identity: '@rtc-a:fixture:device',room:'fixture-room' }), /NETWORK|TLS/); }
  finally { server.close(); }
});

function memoryTlsCertificate(){
  const der=(tag,...parts)=>{const body=Buffer.concat(parts);let h=body.length.toString(16);if(h.length%2)h='0'+h;const length=body.length<128?Buffer.from([body.length]):Buffer.concat([Buffer.from([0x80+h.length/2]),Buffer.from(h,'hex')]);return Buffer.concat([Buffer.from([tag]),length,body]);};
  const seq=(...v)=>der(0x30,...v),oid=hex=>der(6,Buffer.from(hex,'hex')),algorithm=seq(oid('2a8648ce3d040302'));
  const name=seq(der(0x31,seq(oid('550403'),der(12,Buffer.from('localhost')))));
  const time=ms=>der(24,Buffer.from(new Date(ms).toISOString().replace(/[-:T]|\.\d{3}/g,''),'ascii'));
  const {publicKey,privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}),now=Date.now();
  const extensions=der(0xa3,seq(seq(oid('551d11'),der(4,seq(der(0x82,Buffer.from('localhost'))))),seq(oid('551d13'),der(1,Buffer.from([255])),der(4,seq(der(1,Buffer.from([255])))))));
  const tbs=seq(der(0xa0,der(2,Buffer.from([2]))),der(2,Buffer.from([1])),algorithm,name,seq(time(now-60000),time(now+3600000)),name,publicKey.export({type:'spki',format:'der'}),extensions);
  const certificate=seq(tbs,algorithm,der(3,Buffer.from([0]),crypto.sign('sha256',tbs,privateKey)));
  const cert='-----BEGIN CERTIFICATE-----\n'+certificate.toString('base64').match(/.{1,64}/g).join('\n')+'\n-----END CERTIFICATE-----\n';
  return{cert,key:privateKey.export({type:'pkcs8',format:'pem'})};
}
test('default WSS rejects an untrusted certificate on an otherwise working TLS endpoint',async()=>{
  const {cert,key}=memoryTlsCertificate();let upgrades=0;
  const server=https.createServer({cert,key},(_req,res)=>res.end('ok'));
  server.on('upgrade',(req,socket)=>{upgrades++;const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.end();});
  server.listen(0,'localhost');await once(server,'listening');const port=server.address().port;
  const get=options=>new Promise((resolve,reject)=>{const request=https.get({hostname:'localhost',port,ca:cert,signal:AbortSignal.timeout(1000),...options},response=>{response.resume();response.once('end',()=>resolve(response.statusCode));});request.once('error',reject);request.once('upgrade',(response,socket)=>{socket.destroy();resolve(response.statusCode);});});
  try{
    assert.equal(await get({}),200);
    assert.equal(await get({headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':crypto.randomBytes(16).toString('base64')}}),101);
    assert.equal(upgrades,1);
    await assert.rejects(get({servername:'wrong.invalid'}),{code:'ERR_TLS_CERT_ALTNAME_INVALID'});
    await assert.rejects(proof.signal(`wss://localhost:${port}`,'incapable-fixture',{identity:'@rtc-a:fixture:device',room:'fixture-room',timeout:1000}),/NETWORK/);
    assert.equal(upgrades,1);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('a timed-out real child has exited and its pipe and upstream socket are closed before command rejects',async()=>{
  const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');let closed=false,pid;
  const outcome=command(process.execPath,[fileURLToPath(import.meta.url),'--fixture','hold',String(server.address().port)],{budget:new Budget(1000)}).then(()=>null,error=>error);
  const [socket]=await once(server,'connection');socket.once('close',()=>{closed=true;});socket.on('error',()=>{});const [data]=await once(socket,'data');pid=Number(data.toString());
  try{const error=await outcome;assert.equal(error.message,'DEADLINE');assert.throws(()=>process.kill(pid,0));await new Budget(500).waitFor(()=>closed);}
  finally{socket.destroy();server.close();}
});
test('a failed real child cannot pass raw stderr through the command boundary',async()=>{
  const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--fixture','failure-output'],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});const [code]=await once(child,'close');
  assert.equal(code,0);assert.deepEqual(JSON.parse(stdout),{errcode:'COMMAND'});assert.equal(stderr,'');assert.equal(stdout.includes('incapable-child'),false);
});

test('standard unit configures the hard lifetime and a cleanup hook independent of its worker', () => {
  assert.equal(typeof proof.systemdArguments, 'function');
  const args = proof.systemdArguments(contract());
  assert.ok(args.includes('--property=RuntimeMaxSec=120000ms'));
  assert.ok(args.includes('--property=TimeoutStopSec=60s'));
  assert.ok(args.some(value => value.startsWith('--property=ExecStopPost=') && value.endsWith(' __cleanup')));
  assert.ok(args.some(value => value.startsWith('--property=BindReadOnlyPaths=') && value.endsWith(':/etc/hosts')));
  assert.equal(args.some(value => value.includes('supervisor.sock')), false);
});

test('systemd inherits the already consumed public deadline instead of starting another 120 seconds', () => {
  let now=0;const budget=new Budget(120000,()=>now);now=90000;
  assert.ok(proof.systemdArguments(contract(),budget).includes('--property=RuntimeMaxSec=30000ms'));
  assert.ok(proof.systemdArguments(contract(),budget).includes('--property=Type=exec'));
});

test('unit stop receives the remaining cleanup budget instead of a separate ten-second command cap',async()=>{
  const c=contract();let now=0,stopped=false;const budget=new Budget(60000,()=>now);now=45000;
  await proof.stopUnit(c,budget,async(_executable,args,options)=>{
    assert.equal(options.budget,budget);if(args[0]==='show'){now+=1000;return 'BabaCom RTC '+c.runId+'\n'+c.auxiliary.unit+'\nyes\n';}
    assert.equal(options.timeout,14000);assert.equal(options.budget.end,60000);await command(process.execPath,[fileURLToPath(import.meta.url),'--fixture','json','stopped'],options);now+=11000;options.budget.remaining();stopped=true;
  });
  assert.equal(stopped,true);assert.equal(budget.remaining(),3000);
});

test('observed TTL events contain positive returned OpenID seconds and JWT remaining seconds only',()=>{
  const rows=[],events=new SafeEvents(row=>rows.push(row));
  proof.recordTtl(events,'openid_ttl',3600);proof.recordTtl(events,'jwt_remaining',299);
  assert.deepEqual(rows.map(({event,count})=>({event,count})),[{event:'openid_ttl',count:3600},{event:'jwt_remaining',count:299}]);
  for(const seconds of [0,-1,1.5,NaN,Infinity,'incapable-secret',{}])assert.throws(()=>proof.recordTtl(events,'openid_ttl',seconds));
  assert.throws(()=>proof.recordTtl(events,'incapable-secret',1));assert.equal(JSON.stringify(rows).includes('incapable-secret'),false);
});

function contract() {
  return { host: 'lhins-af0ntal8', root: '/opt/babacom-matrix-rtc-e1', project: 'babacom-matrix-rtc-e1',
    runId: 'a'.repeat(32), domain: 'rtc.example.org', port: 18443, certificateSource: 'operator-provisioned-public-chain',
    approved: true, logAdmission: true, machineUuid:'machine', fullAccessHomeservers: ['rtc.example.org:18443'], asHomeserver: 'rtc.example.org:18443',
    platform: 'linux/amd64', source: PINS, sourceHashes: Object.fromEntries(['compose.yaml','homeserver.yaml.example','appservice-registration.yaml.example','livekit.yaml.example','Caddyfile','proof.mjs','proof.test.mjs'].map(name=>[name,'f'.repeat(64)])), auxiliary: { unit: 'babacomrtc'+ 'a'.repeat(32)+'.slice', cgroup: '/sys/fs/cgroup/babacomrtc'+ 'a'.repeat(32)+'.slice', cpu: .1, memory: 134217728 },
    thresholds: { minFreeMemory: 2000000000, minFreeDisk: 3000000000, maxLoad: 2, maxOldCpuPercent: 80, maxOldMemoryGrowth: 100000000 },
    baseline: [{ id: 'b'.repeat(64), image: 'sha256:' + 'c'.repeat(64), status: 'running', mounts: [] }],
    accessors: ['operator-loopback'], certificateSha256: 'd'.repeat(64), nodeSha256:'e'.repeat(64),
    persistence:{corePattern:'core',locations:[{path:'/var/crash',kind:'core-directory',uid:0,gid:0,mode:448,accessors:['root']}]},
    logging:{coverage:['success','timeout','tls','connection','handshake','redirect'],bypasses:[{path:'/var/run/docker.sock',uid:0,gid:0,mode:384,kind:'socket',writesRaw:false,accessors:['root']}]}
  };
}

test('new synthetic persistence and logging exceptions require frozen paths, permissions, accessors and every fault boundary',()=>{
  assert.doesNotThrow(()=>validateContract(contract()));
  for(const key of ['persistence','logging','nodeSha256']){const c=contract();delete c[key];assert.throws(()=>validateContract(c));}
  for(const change of [{persistence:{corePattern:'core',locations:[]}},{logging:{coverage:['success'],bypasses:[]}},{auxiliary:{...contract().auxiliary,unit:'system.slice'}}]) assert.throws(()=>validateContract({...contract(),...change}));
});
test('contract has no domain, port, certificate, baseline, thresholds, log or authority fallback', () => {
  assert.doesNotThrow(() => validateContract(contract()));
  for (const key of ['domain','port','certificateSource','certificateSha256','baseline','thresholds','logAdmission','approved','auxiliary','source','sourceHashes']) {
    const c = contract(); delete c[key]; assert.throws(() => validateContract(c), undefined, key);
  }
  for (const change of [{ port: 0 }, { fullAccessHomeservers: ['*'] }, { asHomeserver: 'other.example.org' }, { fullAccessHomeservers: ['rtc.example.org','other'] }, { domain: 'https://rtc.example.org' }, { platform: 'linux/arm64' }]) assert.throws(() => validateContract({ ...contract(), ...change }));
});

test('startup shares the public deadline through delayed Docker preflight and unit dispatch', async () => {
  let now=0,dispatched=false,cleaned=false;const budget=new Budget(120000,()=>now);
  const io={preflight:async(_c,b)=>{assert.equal(b.remaining(),120000);now+=100000;},launch:async(_c,b)=>{dispatched=true;assert.equal(b.remaining(),20000);return b.end;},status:async(_c,b)=>{now+=21000;b.remaining();},recover:async()=>{cleaned=true;}};
  await assert.rejects(startExperiment(contract(),budget,io),/DEADLINE/);assert.equal(dispatched,true);assert.equal(cleaned,true);assert.equal(now,121000);
});

test('waitFor checks the deadline even if its predicate is already true', async () => {
  let now=0;const budget=new Budget(10,()=>now);now=11;await assert.rejects(budget.waitFor(()=>true),/DEADLINE/);
});
test('BUSY before a new unit launches never stops an existing experiment',async()=>{
  let stopped=false;await assert.rejects(startExperiment(contract(),new Budget(1000),{preflight:async()=>{throw Error('BUSY');},launch:async()=>{throw Error('must not launch');},recover:async()=>{stopped=true;}}),/BUSY/);assert.equal(stopped,false);
});

function receipt(c){return {version:1,host:c.host,machineUuid:'machine',project:c.project,runId:c.runId,containers:['synapse','livekit','auth','caddy'].map((service,n)=>({service,id:String(n+1).repeat(64),image:PINS[service].image,imageId:'sha256:'+String(n+5).repeat(64),created:'2026-10-16T00:00:00Z'}))};}
function inspected(c,row){return {Id:row.id,Image:row.imageId,Created:row.created,State:{Running:true},Config:{Image:row.image,Labels:{'com.docker.compose.project':c.project,'com.docker.compose.service':row.service,'rtc.run':c.runId,'rtc.host':c.host}}};}
test('cleanup uses receipt ownership and fresh checks without depending on a controller PID', async () => {
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

test('receipt cleanup works after actual worker SIGKILL with delayed process-backed Docker fixtures', {timeout:10000}, async()=>{
  const controller=spawn(process.execPath,[fileURLToPath(import.meta.url),'--fixture','idle'],{stdio:['ignore','pipe','pipe']});await once(controller.stdout,'data');controller.kill('SIGKILL');const [code,signal]=await once(controller,'close');assert.ok(code!==0||signal);
  const c=contract(),r=receipt(c),states=new Map(r.containers.map(row=>[row.id,inspected(c,row)])),stopped=[];
  const delayed=async(value,budget)=>JSON.parse(await command(process.execPath,[fileURLToPath(import.meta.url),'--fixture','json',JSON.stringify(value)],{budget}));
  const io={machine:()=>r.machineUuid,inspect:(id,budget)=>delayed(states.get(id),budget),stop:async(id,budget)=>{await delayed({status:'stopped'},budget);stopped.push(id);states.get(id).State.Running=false;}};
  assert.equal(await stopOwned(c,r,new Budget(5000),io),'OK');assert.equal(stopped.length,4);assert.ok([...states.values()].every(i=>!i.State.Running));
});
test('actual delayed Docker child cannot outlive its inherited operation budget', {timeout:3000}, async()=>{
  const start=performance.now();await assert.rejects(command(process.execPath,[fileURLToPath(import.meta.url),'--fixture','late'],{budget:new Budget(40)}),/DEADLINE/);assert.ok(performance.now()-start<500);
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

test('public error enums preserve UNKNOWN, BUSY and deadlines without exposing raw messages or stacks',async()=>{
  for(const message of ['UNKNOWN','BUSY','DEADLINE','FAIL','HOLD','incapable-secret%2Fmarker\nraw stack/body']){
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--fixture','public-error',message],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
    const [code]=await once(child,'close');assert.equal(code,1);assert.equal(stdout,'');assert.deepEqual(JSON.parse(stderr),{service:'verifier',event:'command',errcode:message.startsWith('incapable-')?'HOLD':message});assert.equal(stderr.includes('incapable-secret'),false);assert.equal(stderr.includes('raw stack/body'),false);
  }
});

test('public commands fail closed on unapproved local runtime and print only fixed fields', async () => {
  for(const action of ['preflight','config','up','verify','stop']){
    const child=spawn(process.execPath,[new URL('./proof.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),action],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});const [code]=await once(child,'close');assert.equal(code,1);const result=JSON.parse(output);assert.deepEqual(Object.keys(result),['service','event','errcode']);assert.ok(['HOLD','FAIL'].includes(result.errcode));
  }
});

test('static resource and log contracts are present in all four own containers', () => {
  const compose=fs.readFileSync(new URL('./compose.yaml',import.meta.url),'utf8');assert.equal((compose.match(/image: .*@sha256:[a-f0-9]{64}/g)||[]).length,4);
  for(const required of ['driver: none','memswap_limit: 288m','cpus: 0.2','core: {soft: 0, hard: 0}','read_only: true','internal: true','127.0.0.1:'])assert.ok(compose.includes(required),required);
  assert.equal(compose.includes('logging.FileHandler'),false);assert.ok(compose.includes('secrets/log.config:/run/secrets/log.config:ro'));
  const caddy=fs.readFileSync(new URL('./Caddyfile',import.meta.url),'utf8');assert.ok(caddy.includes('@redirect status 3xx'));assert.ok(caddy.includes('header -Location'));assert.ok(caddy.includes('header -Refresh'));
});
}
