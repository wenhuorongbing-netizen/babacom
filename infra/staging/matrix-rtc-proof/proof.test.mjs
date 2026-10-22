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
import os from 'node:os';
import path from 'node:path';
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
  else if(mode==='readiness'){
    const url=new URL(process.argv[4]),budget=new Budget(2000),runtime=new proof.Runtime({domain:url.hostname,port:Number(url.port)},budget);
    runtime.events=new SafeEvents(row=>process.stdout.write(JSON.stringify(row)+'\n'));
    try{await runtime.waitReady(budget);}catch(error){runtime.recordFailure(error);process.exitCode=1;}
  }
  else if(mode==='hostname-check'){try{const response=await httpRequest(process.argv[4],{servername:'localhost',expectedHostname:process.argv[5],lookup:(_name,options,callback)=>callback(null,options.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4),timeout:1000});process.stdout.write(JSON.stringify({status:response.status}));}catch(error){process.stdout.write(JSON.stringify({errcode:error.message}));}}
  else if(mode==='hostname-keepalive'){
    https.globalAgent.keepAlive=true;https.globalAgent.maxSockets=1;
    const attempt=async expectedHostname=>{try{const response=await httpRequest(process.argv[4],{servername:'localhost',expectedHostname,lookup:(_name,options,callback)=>callback(null,options.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4),timeout:1000});return {status:response.status};}catch(error){return {errcode:error.message};}};
    try{const results=[await attempt(undefined)];await new Promise(resolve=>setImmediate(resolve));results.push(await attempt('incapable.invalid'));process.stdout.write(JSON.stringify(results));}finally{https.globalAgent.destroy();}
  }
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

test('pinned Linux amd64 images accept only their exact captured Docker Hub digest aliases',()=>{
  const captured={synapse:PINS.synapse.image,auth:PINS.auth.image,livekit:'livekit/livekit-server@sha256:f63579e294b6dbf38e0e6151a24a5b425e9293e75e6d41959f470c957248b8a7',caddy:'caddy@sha256:173b26306d711395accaeba8b67afcaad2a085ccb1e6bf26010bfe8c095a5229'};
  for(const [service,digest] of Object.entries(captured)){
    const image={Os:'linux',Architecture:'amd64',RepoDigests:[digest]};assert.doesNotThrow(()=>proof.assertPinnedImage(image,service));assert.doesNotThrow(()=>proof.assertPinnedImage({...image,RepoDigests:[PINS[service].image]},service));
    for(const changed of [digest.replace(/.$/,'0'),digest.replace('@sha256:',':latest@sha256:'),'untrusted.example/'+digest,'other/repository@'+digest.split('@')[1]])assert.throws(()=>proof.assertPinnedImage({...image,RepoDigests:[changed]},service),/^Error: IMAGE$/);
    for(const changed of [{Os:'windows'},{Architecture:'arm64'},{RepoDigests:[]},{RepoDigests:['caddy:latest']}])assert.throws(()=>proof.assertPinnedImage({...image,...changed},service),/^Error: IMAGE$/);
  }
  assert.throws(()=>proof.assertPinnedImage({Os:'linux',Architecture:'amd64',RepoDigests:[PINS.synapse.image.replace('ghcr.io/','')]},'synapse'),/^Error: IMAGE$/);
  assert.throws(()=>proof.assertPinnedImage({Os:'linux',Architecture:'amd64',RepoDigests:[PINS.caddy.image]},'unknown'),/^Error: IMAGE$/);
});
function configuredContainer(c,service){
  const i=inspected(c,receipt(c).containers.find(x=>x.service===service));
  i.HostConfig={LogConfig:{Type:'none'},ReadonlyRootfs:true,CapDrop:['ALL'],CapAdd:service==='caddy'?['NET_BIND_SERVICE']:[],SecurityOpt:['no-new-privileges'],Privileged:false,NetworkMode:c.project+'_isolated',PortBindings:service==='caddy'?{'18443/tcp':[{HostIp:'127.0.0.1',HostPort:'18443'}]}:{},Annotations:{'org.systemd.property.MemorySwapMax':'uint64 0'}};
  const names={caddy:['Caddyfile','tls.crt','tls.key'],synapse:['data','homeserver.yaml','appservice.yaml','log.config'],auth:['appservice.yaml','livekit.key','livekit.secret'],livekit:['livekit.yaml']}[service];
  i.NetworkSettings={Networks:Object.fromEntries((service==='caddy'?['isolated','ingress']:['isolated']).map((name,index)=>[c.project+'_'+name,{NetworkID:String(index+1).repeat(64)}])),Ports:service==='caddy'?{'18443/tcp':[{HostIp:'127.0.0.1',HostPort:'18443'}]}:{}};
  i.LogPath='';i.Mounts=names.map(name=>name==='data'?{Type:'bind',Source:c.root+'/data',Destination:'/data',RW:true}:{Type:'bind',Source:c.root+'/secrets/'+name,Destination:'/run/secrets/'+name,RW:false});
  return i;
}

test('actual container bindings and mounts reject another project, public ports, raw log paths and old business mounts',()=>{
  assert.equal(typeof proof.assertContainerConfiguration,'function');
  const c=contract(),i=configuredContainer(c,'caddy');
  assert.doesNotThrow(()=>proof.assertContainerConfiguration(i,c,'caddy'));
  for(const change of [copy=>copy.HostConfig.PortBindings['18443/tcp'][0].HostIp='0.0.0.0',copy=>copy.Mounts[0].Source='/opt/business/config',copy=>copy.LogPath='/var/log/unsafe.log',copy=>copy.HostConfig.NetworkMode='host',copy=>copy.Mounts[0].RW=true]){const copy=structuredClone(i);change(copy);assert.throws(()=>proof.assertContainerConfiguration(copy,c,'caddy'));}
});
test('Caddy capability admits exactly NET_BIND_SERVICE and rejects missing, duplicate or extra capabilities',()=>{
  const c=contract();
  for(const CapAdd of [['NET_BIND_SERVICE'],['CAP_NET_BIND_SERVICE']]){const i=configuredContainer(c,'caddy');i.HostConfig.CapAdd=CapAdd;assert.doesNotThrow(()=>proof.assertContainerConfiguration(i,c,'caddy'));}
  for(const CapAdd of [undefined,null,[],['NET_ADMIN'],['ALL'],['NET_BIND_SERVICE','SYS_ADMIN'],['NET_BIND_SERVICE','NET_BIND_SERVICE'],['NET_BIND_SERVICE','CAP_NET_BIND_SERVICE'],'NET_BIND_SERVICE',{length:0}]){
    const i=configuredContainer(c,'caddy');i.HostConfig.CapAdd=CapAdd;assert.throws(()=>proof.assertContainerConfiguration(i,c,'caddy'),/^Error: CONFIG$/);
  }
});

test('other RTC services cannot inherit Caddy capability or any other capability',()=>{
  const c=contract();
  for(const service of ['synapse','auth','livekit']){
    for(const CapAdd of [undefined,null,[]]){const i=configuredContainer(c,service);i.HostConfig.CapAdd=CapAdd;assert.doesNotThrow(()=>proof.assertContainerConfiguration(i,c,service));}
    for(const CapAdd of [['NET_BIND_SERVICE'],['CAP_NET_BIND_SERVICE'],['SYS_ADMIN'],['ALL'],{length:0}]){const i=configuredContainer(c,service);i.HostConfig.CapAdd=CapAdd;assert.throws(()=>proof.assertContainerConfiguration(i,c,service),/^Error: CONFIG$/);}
  }
});

test('all RTC containers retain drop ALL, no-new-privileges and read-only isolation',()=>{
  const c=contract();
  for(const service of ['synapse','auth','livekit','caddy']){
    for(const SecurityOpt of [['no-new-privileges'],['no-new-privileges:true'],['no-new-privileges=true']]){const i=configuredContainer(c,service);i.HostConfig.SecurityOpt=SecurityOpt;assert.doesNotThrow(()=>proof.assertContainerConfiguration(i,c,service));}
    for(const changed of [{CapDrop:[]},{SecurityOpt:[]},{SecurityOpt:['no-new-privileges:false']},{SecurityOpt:['no-new-privileges','no-new-privileges:false']},{ReadonlyRootfs:false},{Privileged:true}]){const i=configuredContainer(c,service);Object.assign(i.HostConfig,changed);assert.throws(()=>proof.assertContainerConfiguration(i,c,service),/^Error: CONFIG$/);}
  }
});

test('every new container requires exactly the signed zero-swap annotation',()=>{
  const c=contract();
  for(const service of ['synapse','auth','livekit','caddy']){
    const i=configuredContainer(c,service);assert.doesNotThrow(()=>proof.assertContainerConfiguration(i,c,service));
    for(const Annotations of [undefined,null,{},[],{'org.systemd.property.MemorySwapMax':'0'},{'org.systemd.property.MemorySwapMax':'uint64 1'},{'org.systemd.property.MemorySwapMax':0},{'org.systemd.property.MemorySwapMax':'uint64 0',other:'uint64 0'}]){
      const copy=structuredClone(i);copy.HostConfig.Annotations=Annotations;assert.throws(()=>proof.assertContainerConfiguration(copy,c,service),/^Error: SWAP$/);
    }
  }
});

test('owned container PID, systemd scope and kernel must agree on zero swap',async()=>{
  assert.equal(typeof proof.containerCgroup,'function');
  const c=contract(),i=configuredContainer(c,'caddy');i.State={Running:true,Pid:4321,OOMKilled:false};
  const unit='docker-'+i.Id+'.scope',rel='/system.slice/'+unit,group='/sys/fs/cgroup'+rel;
  const files={['/proc/4321/cgroup']:'0::'+rel+'\n',[group+'/cpu.max']:'20000 100000\n',[group+'/memory.max']:'301989888\n',[group+'/memory.swap.max']:'0\n'};
  const state={Id:unit,ActiveState:'active',SubState:'running',ControlGroup:rel,MemorySwapMax:'0'};
  const io={read:file=>{assert.ok(Object.hasOwn(files,file));return files[file];},show:async(name,budget)=>{assert.equal(name,unit);budget.remaining();return state;}};
  assert.deepEqual(await proof.containerCgroup(c,i,new Budget(1000),io),{cgroup:group,cpu:.2,memory:301989888});
  for(const MemorySwapMax of [undefined,'infinity','18446744073709551615','1'])await assert.rejects(proof.containerCgroup(c,i,new Budget(1000),{...io,show:async()=>({...state,MemorySwapMax})}),/^Error: SWAP$/);
  files[group+'/memory.swap.max']='max\n';await assert.rejects(proof.containerCgroup(c,i,new Budget(1000),io),/^Error: SWAP$/);files[group+'/memory.swap.max']='0\n';
  for(const changed of [{Id:'docker-'+c.baseline[0].id+'.scope'},{ControlGroup:'/other/'+unit},{ActiveState:'inactive'},{SubState:'dead'}])await assert.rejects(proof.containerCgroup(c,i,new Budget(1000),{...io,show:async()=>({...state,...changed})}),/^Error: UNKNOWN$/);
  for(const value of ['0::/system.slice/docker-'+c.baseline[0].id+'.scope\n','0::'+rel+'/child\n','0::'+rel+'\n0::'+rel+'\n','0::/system.slice/../'+unit+'\n']){
    let shown=false;await assert.rejects(proof.containerCgroup(c,i,new Budget(1000),{...io,read:file=>file==='/proc/4321/cgroup'?value:io.read(file),show:async()=>{shown=true;return state;}}),/^Error: UNKNOWN$/);assert.equal(shown,false);
  }
  await assert.rejects(proof.containerCgroup(c,i,new Budget(1000),{...io,read:()=>{throw Error('/private/raw-path');}}),/^Error: HOLD$/);
  let clock=0;const budget=new Budget(10,()=>clock);await assert.rejects(proof.containerCgroup(c,i,budget,{...io,show:async()=>{clock=11;return state;}}),/^Error: DEADLINE$/);
});

test('baseline mount comparison ignores only property and mount order while preserving every value and multiplicity',()=>{
  const frozen=[{Type:'bind',Source:'/home/ubuntu/recordings',Destination:'/data',Mode:'ro',RW:false,Propagation:'rprivate'},{Type:'volume',Name:'recorder-cache',Source:'/var/lib/docker/volumes/recorder-cache/_data',Destination:'/cache',Driver:'local',Mode:'rw',RW:true,Propagation:'',Options:{Labels:{purpose:'cache',scope:'recorder'},Flags:['first','second']}}];
  const reordered=frozen.toReversed().map(mount=>Object.fromEntries(Object.entries(mount).reverse()));reordered[0].Options=Object.fromEntries(Object.entries(reordered[0].Options).reverse());reordered[0].Options.Labels={scope:'recorder',purpose:'cache'};
  const original=structuredClone(frozen);assert.equal(proof.sameMounts(reordered,frozen),true);assert.equal(proof.sameMounts([],[]),true);assert.equal(proof.sameMounts([frozen[1],frozen[0],frozen[1]],[frozen[1],frozen[1],frozen[0]]),true);
  for(const change of [mounts=>mounts[0].Source='/other',mounts=>mounts[0].Destination='/elsewhere',mounts=>mounts[0].RW=true,mounts=>mounts[0].Type='volume',mounts=>mounts[0].Mode='rw',mounts=>mounts[0].Propagation='shared',mounts=>mounts[1].Name='other-volume',mounts=>mounts[1].Driver='other',mounts=>mounts[1].Options.Labels.scope='other',mounts=>mounts[1].Options.Flags.reverse(),mounts=>delete mounts[0].RW,mounts=>mounts[0].Extra='new',mounts=>mounts.pop(),mounts=>mounts.push(structuredClone(mounts[0]))]){const changed=structuredClone(frozen);change(changed);assert.equal(proof.sameMounts(changed,frozen),false);}
  assert.equal(proof.sameMounts([frozen[0],frozen[0],frozen[1]],[frozen[0],frozen[1],frozen[1]]),false);assert.equal(proof.sameMounts(null,frozen),false);assert.deepEqual(frozen,original);
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
    assert.equal(options.budget,budget);if(args[0]==='show'){now+=1000;return 'Description=BabaCom RTC '+c.runId+'\nSlice='+c.auxiliary.unit+'\nTransient=yes\nLoadState=loaded\n';}
    assert.equal(options.timeout,14000);assert.equal(options.budget.end,60000);await command(process.execPath,[fileURLToPath(import.meta.url),'--fixture','json','stopped'],options);now+=11000;options.budget.remaining();stopped=true;
  });
  assert.equal(stopped,true);assert.equal(budget.remaining(),3000);
});


test('running Caddy must have an actual loopback publication rather than only a requested binding',()=>{
  const c=contract(),i=configuredContainer(c,'caddy');
  i.NetworkSettings={Networks:{[c.project+'_isolated']:{NetworkID:'1'.repeat(64)},[c.project+'_ingress']:{NetworkID:'2'.repeat(64)}},Ports:{'18443/tcp':[{HostIp:'127.0.0.1',HostPort:'18443'}],'80/tcp':null}};
  assert.doesNotThrow(()=>proof.assertContainerConfiguration(i,c,'caddy'));
  for(const Ports of [{},{'18443/tcp':null},{'18443/tcp':[]},{'18443/tcp':[{HostIp:'0.0.0.0',HostPort:'18443'}]},{...i.NetworkSettings.Ports,'443/tcp':[{HostIp:'127.0.0.1',HostPort:'443'}]}]){
    assert.throws(()=>proof.assertContainerConfiguration({...i,NetworkSettings:{...i.NetworkSettings,Ports}},c,'caddy'),/^Error: PORT$/);
  }
});
test('only Caddy may join the exact own ingress network and an internal-only Caddy is refused',()=>{
  const c=contract(),i=configuredContainer(c,'caddy');
  i.NetworkSettings={Networks:{[c.project+'_isolated']:{NetworkID:'1'.repeat(64)},[c.project+'_ingress']:{NetworkID:'2'.repeat(64)}},Ports:{'18443/tcp':[{HostIp:'127.0.0.1',HostPort:'18443'}]}};
  assert.doesNotThrow(()=>proof.assertContainerConfiguration(i,c,'caddy'));
  for(const Networks of [{[c.project+'_isolated']:{NetworkID:'1'.repeat(64)}},{...i.NetworkSettings.Networks,business:{NetworkID:'3'.repeat(64)}}]){
    assert.throws(()=>proof.assertContainerConfiguration({...i,NetworkSettings:{...i.NetworkSettings,Networks}},c,'caddy'),/^Error: CONFIG$/);
  }
  const other=configuredContainer(c,'auth');other.NetworkSettings={Networks:structuredClone(i.NetworkSettings.Networks),Ports:{}};
  assert.throws(()=>proof.assertContainerConfiguration(other,c,'auth'),/^Error: CONFIG$/);
});
test('collected transient worker can be stopped again only with zero processes, no job and empty cgroup',async()=>{
  const c=contract(),budget=new Budget(60000),deadline=budget.end;
  const missing={LoadState:'not-found',ActiveState:'inactive',MainPID:'0',ControlPID:'0',Job:'',ControlGroup:''};
  const text=state=>Object.entries(state).map(([key,value])=>key+'='+value).join('\n');
  const run=async(_exe,args,options)=>{assert.equal(options.budget,budget);assert.equal(args[0],'show');return text(missing);};
  await assert.doesNotReject(proof.stopUnit(c,budget,run,()=>null));
  await assert.doesNotReject(proof.unitStopped(c,budget,run,()=>'populated 0\nfrozen 0\n'));
  for(const changed of [{MainPID:'9'},{ControlPID:'9'},{Job:'1 x'},{ActiveState:'active'},{ControlGroup:'/system.slice/foreign.service'}]){
    await assert.rejects(proof.stopUnit(c,budget,async()=>text({...missing,...changed}),()=>null),/^Error: UNKNOWN$/);
  }
  await assert.rejects(proof.stopUnit(c,budget,run,()=>'populated 1\n'),/^Error: UNKNOWN$/);
  await assert.rejects(proof.stopUnit(c,budget,async()=>{throw Error('COMMAND');},()=>null),/^Error: COMMAND$/);
  assert.equal(budget.end,deadline);
});
test('stopped container with a remaining PID or pause flag cannot pass receipt-owned cleanup',async()=>{
  const c=contract(),r=receipt(c);
  for(const changed of [{Pid:123},{Paused:true}]){
    const result=await stopOwned(c,r,new Budget(1000),{machine:()=>c.machineUuid,inspect:async id=>({...inspected(c,r.containers.find(row=>row.id===id)),State:{Running:false,Pid:0,Paused:false,...changed}})});
    assert.equal(result,'UNKNOWN');
  }
});


test('actual bridge topology rejects external backends, foreign members and wrong run labels',()=>{
  const c=contract(),containers=['synapse','livekit','auth','caddy'].map(service=>configuredContainer(c,service));
  const networks=['isolated','ingress'].map((name,index)=>({
    Id:String(index+1).repeat(64),Name:c.project+'_'+name,Driver:'bridge',Scope:'local',Internal:name==='isolated',EnableIPv6:false,
    Labels:{'com.docker.compose.project':c.project,'com.docker.compose.network':name,'rtc.host':c.host,'rtc.run':c.runId},
    Options:name==='ingress'?{'com.docker.network.bridge.host_binding_ipv4':'127.0.0.1'}:{},
    Containers:Object.fromEntries(containers.filter(i=>name==='isolated'||i.Config.Labels['com.docker.compose.service']==='caddy').map(i=>[i.Id,{}]))
  }));
  assert.doesNotThrow(()=>proof.assertNetworkTopology(c,containers,networks));
  for(const mutate of [
    rows=>rows[0].Internal=false,rows=>rows[1].Internal=true,rows=>rows[0].Labels['rtc.run']='old',
    rows=>rows[1].Containers[containers[0].Id]={},rows=>rows[0].Containers['f'.repeat(64)]={},
    rows=>rows[1].Options['com.docker.network.bridge.host_binding_ipv4']='0.0.0.0',rows=>rows[0].Driver='host',
    rows=>rows[1].Id='f'.repeat(64)
  ]){const copy=structuredClone(networks);mutate(copy);assert.throws(()=>proof.assertNetworkTopology(c,containers,copy),/^Error: CONFIG$/);}
});
test('public cleanup after worker collection still checks every receipt container and the final baseline',async()=>{
  const c=contract(),r=receipt(c),rows=[],events=new SafeEvents(row=>rows.push(row)),budget=new Budget(60000);let reads=0,checked=false;
  const missing='LoadState=not-found\nActiveState=inactive\nMainPID=0\nControlPID=0\nJob=\nControlGroup=\n',run=async()=>missing;
  const recovery={machine:()=>c.machineUuid,inspect:async id=>{reads++;return {...inspected(c,r.containers.find(row=>row.id===id)),State:{Running:false,Pid:0,Paused:false}};}};
  const io={admit:()=>{},acquireBudget:()=>budget,readReceipt:()=>r,recovery,stopWorker:true,stopWorkerUnit:(c,b)=>proof.stopUnit(c,b,run,()=>null),checkUnit:(c,b)=>proof.unitStopped(c,b,run,()=>null),checkBaseline:async()=>{checked=true;}};
  await proof.cleanupHook(c,events,io);assert.equal(reads,8);assert.equal(checked,true);assert.equal(rows.at(-1).errcode,'OK');
  await assert.rejects(proof.cleanupHook(c,events,{...io,readReceipt:()=>({...r,runId:'old'})}),/^Error: UNKNOWN$/);
  await assert.rejects(proof.cleanupHook(c,events,{...io,checkBaseline:async()=>{throw Error('BASELINE');}}),/^Error: BASELINE$/);
});
test('loaded worker ownership cannot be bypassed by an inactive state or a lookalike name',async()=>{
  const c=contract(),state={LoadState:'loaded',Description:'BabaCom RTC '+c.runId,Slice:c.auxiliary.unit,Transient:'yes',ActiveState:'inactive',MainPID:'0',ControlPID:'0',Job:'',ControlGroup:''};
  const text=row=>Object.entries(row).map(([key,value])=>key+'='+value).join('\n');
  for(const changed of [{Description:'foreign'},{Slice:'system.slice'},{Transient:'no'}]){
    let stops=0;const run=async(_exe,args)=>{if(args[0]==='stop'){stops++;return '';}return text({...state,...changed});};
    await assert.rejects(proof.stopUnit(c,new Budget(1000),run,()=>null),/^Error: UNKNOWN$/);assert.equal(stops,0);
    await assert.rejects(proof.unitStopped(c,new Budget(1000),run,()=>null),/^Error: UNKNOWN$/);
  }
});

test('observed TTL events contain positive returned OpenID seconds and JWT remaining seconds only',()=>{
  const rows=[],events=new SafeEvents(row=>rows.push(row));
  proof.recordTtl(events,'openid_ttl',3600);proof.recordTtl(events,'jwt_remaining',299);
  assert.deepEqual(rows.map(({event,count})=>({event,count})),[{event:'openid_ttl',count:3600},{event:'jwt_remaining',count:299}]);
  for(const seconds of [0,-1,1.5,NaN,Infinity,'incapable-secret',{}])assert.throws(()=>proof.recordTtl(events,'openid_ttl',seconds));
  assert.throws(()=>proof.recordTtl(events,'incapable-secret',1));assert.equal(JSON.stringify(rows).includes('incapable-secret'),false);
});

function contract() {
  return { host: 'lhins-af0ntal8', root: '/opt/babacom-matrix-rtc-e6', project: 'babacom-matrix-rtc-e6',
    runId: 'a'.repeat(32), domain: 'rtc.example.org', port: 18443, certificateSource: 'operator-provisioned-public-chain',
    approved: true, logAdmission: true, machineUuid:'machine', fullAccessHomeservers: ['rtc.example.org:18443'], asHomeserver: 'rtc.example.org:18443',
    platform: 'linux/amd64', source: PINS, sourceHashes: Object.fromEntries(['compose.yaml','homeserver.yaml.example','appservice-registration.yaml.example','livekit.yaml.example','Caddyfile','proof.mjs','proof.test.mjs'].map(name=>[name,'f'.repeat(64)])), auxiliary: { unit: 'babacomrtc'+ 'a'.repeat(32)+'.slice', cgroup: '/sys/fs/cgroup/babacomrtc'+ 'a'.repeat(32)+'.slice', cpu: .1, memory: 134217728 },
    thresholds: { minFreeMemory: 2000000000, minFreeDisk: 3000000000, maxLoad: 2, maxOldCpuPercent: 80, maxOldMemoryGrowth: 100000000 },
    sharedRuntime:{sampleIntervalMs:250,maxCpuPercent:100,maxMemoryGrowth:100000000,services:['docker','containerd'].map((name,index)=>({unit:name+'.service',invocationId:String(index+1).repeat(32),pid:100+index,startTime:'1000',cgroup:'/sys/fs/cgroup/system.slice/'+name+'.service',inode:100+index,cpuUsageUsec:1000,memoryUsageBytes:1000000}))},
    baseline: [{ id: 'b'.repeat(64), image: 'sha256:' + 'c'.repeat(64), status: 'running', mounts: [] }],
    nativeBaseline:['control','gateway','relay','staging','staging-relay'].map((name,index)=>({unit:'maowo-'+name+'.service',pid:200+index,invocationId:String(index+3).repeat(32)})),
    accessors: ['operator-loopback'], certificateSha256: 'd'.repeat(64), nodeSha256:'e'.repeat(64),
    persistence:{corePattern:'core',locations:[{path:'/var/crash',kind:'core-directory',uid:0,gid:0,mode:448,accessors:['root']}]},
    logging:{coverage:['success','timeout','tls','connection','handshake','redirect'],bypasses:[{path:'/var/run/docker.sock',uid:0,gid:0,mode:384,kind:'socket',writesRaw:false,accessors:['root']}]}
  };
}

test('fresh e6 contract cannot reuse e1, e2, e3, e4, e5 or a mixed deployment identity',()=>{
  const c=contract();assert.equal(validateContract(c),c);
  for(const [root,project] of [...['e1','e2','e3','e4','e5'].flatMap(batch=>[['/opt/babacom-matrix-rtc-'+batch,'babacom-matrix-rtc-'+batch],[c.root,'babacom-matrix-rtc-'+batch],['/opt/babacom-matrix-rtc-'+batch,c.project]]),[c.root+'/other',c.project],[c.root,c.project+'-other']])assert.throws(()=>validateContract({...c,root,project}),/^Error: CONTRACT$/);
});

test('all e6 bind sources, templates and cleanup hooks stay outside retained e1/e2/e3/e4/e5',()=>{
  const c=contract(),compose=fs.readFileSync(new URL('./compose.yaml',import.meta.url),'utf8');
  assert.match(compose,/^name: babacom-matrix-rtc-e6$/m);
  assert.match(compose,/^  annotations: \{org\.systemd\.property\.MemorySwapMax: "uint64 0"\}$/m);
  const sources=[...compose.matchAll(/\/opt\/[^:\s,\]]+(?=:\/)/g)].map(match=>match[0]);
  const names=['data','secrets/homeserver.yaml','secrets/appservice.yaml','secrets/log.config','secrets/livekit.yaml','secrets/appservice.yaml','secrets/livekit.key','secrets/livekit.secret','secrets/Caddyfile','secrets/tls.crt','secrets/tls.key'];
  assert.deepEqual(sources.sort(),names.map(name=>c.root+'/'+name).sort());
  assert.equal(templateValues(c,{}).ROOT,c.root);
  const args=proof.systemdArguments(c);
  assert.ok(args.includes('--property=BindReadOnlyPaths='+c.root+'/hosts:/etc/hosts'));
  assert.ok(args.includes('--property=ExecStopPost='+process.execPath+' '+c.root+'/proof.mjs __cleanup'));
  for(const batch of ['e1','e2','e3','e4','e5'])assert.equal(args.some(value=>value.replaceAll(process.execPath,'<node>').includes('/opt/babacom-matrix-rtc-'+batch)),false);
});

test('e6 cleanup refuses retained e1/e2/e3/e4/e5 receipts and containers before mutation',async()=>{
  const c=contract();
  for(const batch of ['e1','e2','e3','e4','e5']){
    const old={...c,root:'/opt/babacom-matrix-rtc-'+batch,project:'babacom-matrix-rtc-'+batch},r=receipt(old);let inspectedCount=0,mutations=0;
    assert.equal(await stopOwned(c,r,new Budget(1000),{machine:()=>c.machineUuid,inspect:async()=>{inspectedCount++;},stop:async()=>{mutations++;},unpause:async()=>{mutations++;}}),'UNKNOWN');
    assert.equal(inspectedCount,0);assert.equal(mutations,0);
    for(const row of r.containers)assert.throws(()=>assertOwned(inspected(old,row),c,row.service),/^Error: UNKNOWN$/);
  }
});

test('e6 actual mounts cannot refer to retained e1/e2/e3/e4/e5 secrets or database',()=>{
  const c=contract();
  for(const service of ['synapse','livekit','auth','caddy']){
    const i=configuredContainer(c,service);assert.doesNotThrow(()=>proof.assertContainerConfiguration(i,c,service));
    for(const batch of ['e1','e2','e3','e4','e5'])for(let index=0;index<i.Mounts.length;index++){const copy=structuredClone(i);copy.Mounts[index].Source=copy.Mounts[index].Source.replace(c.root,'/opt/babacom-matrix-rtc-'+batch);assert.throws(()=>proof.assertContainerConfiguration(copy,c,service),/^Error: MOUNTS$/);}
  }
});

test('old native services require a complete frozen identity baseline',()=>{
  const c=contract();
  for(const change of [copy=>delete copy.nativeBaseline,copy=>copy.nativeBaseline=[],copy=>copy.nativeBaseline.pop(),copy=>copy.nativeBaseline[0].unit='docker.service',copy=>copy.nativeBaseline[1].unit=copy.nativeBaseline[0].unit,copy=>copy.nativeBaseline[0].pid=0,copy=>copy.nativeBaseline[0].invocationId='']){
    const copy=structuredClone(c);change(copy);assert.throws(()=>validateContract(copy),/^Error: BASELINE$/);
  }
});
test('a concurrent old native restart latches failure while receipt-owned cleanup continues',async()=>{
  assert.equal(typeof proof.assertNativeBaseline,'function');
  const c=contract(),r=receipt(c);let restart=false,reads=0;const stopped=[];
  const show=async row=>{reads++;return {ActiveState:'active',SubState:'running',MainPID:String(row.pid),InvocationID:restart?'f'.repeat(32):row.invocationId};};
  const budget=new Budget(1000),watch=new proof.ResourceWatch(current=>proof.assertNativeBaseline(c,current,show),budget,100);
  await watch.sample();assert.equal(reads,5);restart=true;await assert.rejects(watch.sample(),/^Error: FAIL$/);assert.equal(watch.controller.signal.aborted,true);await watch.close(new Budget(1000));
  const events=[];new SafeEvents(event=>events.push(event)).event('verifier','fault',0,watch.fault);assert.equal(events[0].errcode,'BASELINE_NATIVE_INVOCATION');assert.equal(events[0].count,1);
  const result=await stopOwned(c,r,new Budget(1000),{machine:()=>c.machineUuid,inspect:async id=>({...inspected(c,r.containers.find(row=>row.id===id)),State:{Running:!stopped.includes(id),Pid:stopped.includes(id)?0:123,Paused:false}}),stop:async id=>stopped.push(id),sample:(_c,current)=>proof.assertNativeBaseline(c,current,show)});
  assert.equal(result,'FAIL');assert.deepEqual(new Set(stopped),new Set(r.containers.map(row=>row.id)));assert.throws(()=>watch.check(),/^Error: FAIL$/);
});
test('baseline evidence identifies the failed host threshold and its measured and frozen values',()=>{
  const c=contract(),healthy={freeMemory:3000000000,load:1,freeDisk:4000000000};
  assert.equal(typeof proof.assertHostBaseline,'function');
  assert.doesNotThrow(()=>proof.assertHostBaseline(c,healthy));
  assert.doesNotThrow(()=>proof.assertHostBaseline(c,{freeMemory:2000000000,load:2,freeDisk:3000000000}));
  for(const [sample,code,actual,limit] of [
    [{...healthy,freeMemory:1999999999},'BASELINE_MEMORY',1999999999,2000000000],
    [{...healthy,load:2.125},'BASELINE_LOAD',2125,2000],
    [{...healthy,freeDisk:2999999999},'BASELINE_DISK',2999999999,3000000000]
  ]){
    let error;try{proof.assertHostBaseline(c,sample);}catch(failure){error=failure;}
    assert.equal(error?.message,'BASELINE');
    const rows=[];new SafeEvents(row=>rows.push(row)).event('verifier','fault',0,error);
    assert.deepEqual(rows,[{service:'verifier',event:'fault',status:0,errcode:code,count:1},
      {service:'verifier',event:'baseline_actual',status:0,errcode:code,count:actual},
      {service:'verifier',event:'baseline_limit',status:0,errcode:code,count:limit}]);
  }
});
test('native baseline failures identify the exact condition and frozen row without publishing identity strings',async()=>{
  const c=contract();
  for(const [change,code] of [
    [state=>state.ActiveState='failed','BASELINE_NATIVE_ACTIVE'],
    [state=>state.SubState='exited','BASELINE_NATIVE_SUBSTATE'],
    [state=>state.MainPID='999','BASELINE_NATIVE_PID'],
    [state=>state.InvocationID='incapable-secret','BASELINE_NATIVE_INVOCATION']
  ]){
    let failure;try{await proof.assertNativeBaseline(c,new Budget(1000),async row=>{
      const state={ActiveState:'active',SubState:'running',MainPID:String(row.pid),InvocationID:row.invocationId};
      if(row===c.nativeBaseline[2])change(state);return state;
    });}catch(error){failure=error;}
    assert.equal(failure?.message,'FAIL');const rows=[];new SafeEvents(row=>rows.push(row)).event('verifier','fault',0,failure);
    assert.equal(rows[0].errcode,code);assert.equal(rows[0].count,3);
    assert.equal(JSON.stringify(rows).includes('incapable-secret'),false);
  }
});
test('container baseline failures separate image, state, mounts and frozen counter conditions',()=>{
  assert.equal(typeof proof.assertContainerBaseline,'function');
  const frozen={image:'sha256:'+ 'a'.repeat(64),status:'running',mounts:[],memoryUsageBytes:1000};
  const current={Image:frozen.image,State:{Status:'running'},Mounts:[]};
  assert.doesNotThrow(()=>proof.assertContainerBaseline(frozen,current,2));
  for(const [old,now,code] of [
    [frozen,{...current,Image:'incapable-secret'},'BASELINE_IMAGE'],
    [frozen,{...current,State:{Status:'exited'}},'BASELINE_STATE'],
    [frozen,{...current,Mounts:[{Source:'incapable-secret'}]},'BASELINE_MOUNTS'],
    [{...frozen,memoryUsageBytes:undefined},current,'BASELINE_COUNTER']
  ]){
    let failure;try{proof.assertContainerBaseline(old,now,2);}catch(error){failure=error;}
    assert.equal(failure?.message,'BASELINE');const rows=[];new SafeEvents(row=>rows.push(row)).event('verifier','fault',0,failure);
    assert.deepEqual(rows,[{service:'verifier',event:'fault',status:0,errcode:code,count:2}]);
    assert.equal(JSON.stringify(rows).includes('incapable-secret'),false);
  }
});

test('configuration can prepare protected files before explicit log admission',()=>{
  const c=contract();c.logAdmission=false;
  assert.equal(validateContract(c,'config'),c);
});

test('pending log admission permits preparation and recovery but neither JSON Boolean unlocks credentials',async()=>{
  for(const flag of [false,true]){
    const c=contract();c.logAdmission=flag;
    for(const action of ['preflight','config','up','verify','stop','__run','__cleanup'])assert.equal(validateContract(c,action),c);
    const runtime=new proof.Runtime(c,new Budget(1000));let requests=0;
    runtime.api=async()=>{requests++;throw Error('unexpected request');};
    runtime.audit=async()=>{requests++;};
    for(const attempt of [()=>runtime.register('rtc-a',new Budget(1000)),()=>runtime.openid({user_id:'synthetic'},new Budget(1000)),()=>runtime.admin('ListParticipants',{room:'synthetic'},new Budget(1000)),()=>runtime.verify(new Budget(1000))])await assert.rejects(attempt(),/LOG_ADMISSION/);
    assert.equal(requests,0);
    const guarded=new proof.Runtime(c,new Budget(1000));
    await assert.rejects(guarded.api('/_matrix/client/v3/account/whoami',{token:'synthetic'},new Budget(1000)),/LOG_ADMISSION/);
    await assert.rejects(guarded.api('/_synapse/admin/v1/register',{method:'POST',body:{username:'rtc-a'}},new Budget(1000)),/LOG_ADMISSION/);
    await assert.rejects(guarded.auth({openid_token:{access_token:'synthetic'}},new Budget(1000)),/LOG_ADMISSION/);
  }
});
test('one incapable 401 and claimed coverage cannot establish the in-memory log gate',async()=>{
  const runtime=new proof.Runtime(contract(),new Budget(1000));
  runtime.auth=async()=>({status:401,body:Buffer.from('{"errcode":"M_UNAUTHORIZED"}')});runtime.scan=async()=>{};runtime.events=new SafeEvents(()=>{});
  await assert.rejects(runtime.sentinels(new Budget(1000)),/LOG_ADMISSION/);
  assert.notEqual(runtime.loggingAdmitted,true);
});

test('configuration requires an explicit boolean log flag and an approved contract',()=>{
  for(const flag of [undefined,null,0,1,'false','true',{}]){
    const c=contract();c.logAdmission=flag;
    assert.throws(()=>validateContract(c,'config'),/CONTRACT/);
  }
  for(const flag of [false,true]){
    const c=contract();c.logAdmission=flag;c.approved=false;
    assert.throws(()=>validateContract(c,'config'),/CONTRACT/);
  }
});

test('shared runtime admission requires frozen identities, disjoint non-root groups and finite stop thresholds',()=>{
  assert.doesNotThrow(()=>validateContract(contract()));
  for(const change of [c=>delete c.sharedRuntime,c=>c.sharedRuntime.maxCpuPercent=Infinity,c=>c.sharedRuntime.maxMemoryGrowth=NaN,c=>delete c.sharedRuntime.services[0].invocationId,c=>c.sharedRuntime.services[0].cgroup='/sys/fs/cgroup',c=>c.sharedRuntime.services[1].cgroup=c.sharedRuntime.services[0].cgroup,c=>c.sharedRuntime.services[1].cgroup=c.sharedRuntime.services[0].cgroup+'/nested',c=>c.sharedRuntime.services[0].cgroup=c.auxiliary.cgroup]){const c=contract();change(c);assert.throws(()=>validateContract(c));}
});
test('recognized experiment shims may use an admitted shared group but cannot escape into another or own workload group',()=>{
  const c=contract(),id='1'.repeat(64),args=['/usr/bin/containerd-shim-runc-v2','-namespace','moby','-id',id],groups=[c.auxiliary.cgroup,'/sys/fs/cgroup/system.slice/docker-'+id+'.scope'];
  assert.doesNotThrow(()=>proof.assertSharedShim(c,id,args,c.sharedRuntime.services[1].cgroup,groups));
  for(const [changed,group] of [[args,'/sys/fs/cgroup/system.slice/other.service'],[[...args.slice(0,-1),'2'.repeat(64)],c.sharedRuntime.services[1].cgroup],[[...args.slice(0,2),'other',...args.slice(3)],c.sharedRuntime.services[1].cgroup],[args,c.auxiliary.cgroup]])assert.throws(()=>proof.assertSharedShim(c,id,changed,group,groups));
});
test('shared cpu.stat and memory.current samples enforce aggregate growth and reject resets, invalid counters or unreadable groups',async()=>{
  const c=contract(),rows=c.sharedRuntime.services.map(row=>({...row,kind:'shared'}));
  const sample=async({cpu=2000,memory=1001000,bad,fail=false}={})=>{let now=0;return proof.sampleResources(c,rows,new Budget(1000,()=>now/1000),{now:()=>now,sleep:async()=>{now=100000;},read:file=>{if(fail)throw Error('incapable-read-error');return file.endsWith('/cpu.stat')?(bad??'usage_usec '+(now?cpu:1000)+'\nuser_usec 0\n'):String(memory);},previous:new Map()});};
  await assert.doesNotReject(sample());await assert.rejects(sample({cpu:200000}));await assert.rejects(sample({memory:1000000000}));await assert.rejects(sample({cpu:999}));
  for(const bad of ['usage_usec NaN','usage_usec 9007199254740992','usage_usec -1','user_usec 1','usage_usec 1000\nusage_usec NaN'])await assert.rejects(sample({bad}));await assert.rejects(sample({fail:true}));
  await assert.rejects(sample({memory:'NaN'}));await assert.rejects(sample({memory:9007199254740992}));
});
test('resource failure evidence retains the specific stop reason across monitor normalization',async()=>{
  for(const [kind,cpu,memory,want] of [['old',200000,1001000,'OLD_CPU'],['old',2000,200000000,'OLD_MEMORY'],['shared',200000,1001000,'SHARED_CPU'],['shared',2000,200000000,'SHARED_MEMORY']]){
    const c=contract(),rows=[{...c.sharedRuntime.services[0],kind}],events=[],budget=new Budget(1000);let now=0;
    const watch=new proof.ResourceWatch(()=>proof.sampleResources(c,rows,new Budget(1000,()=>now/1000),{now:()=>now,sleep:async()=>{now=100000;},read:file=>file.endsWith('/cpu.stat')?'usage_usec '+(now?cpu:1000)+'\n':String(memory),previous:new Map()}),budget,1000);
    try{
      await assert.rejects(watch.start(),/FAIL/);assert.equal(watch.controller.signal.aborted,true);assert.throws(()=>budget.remaining(),/FAIL/);
      new SafeEvents(row=>events.push(row)).event('verifier','fault',0,watch.fault);
      assert.deepEqual(events,[{service:'verifier',event:'fault',status:0,errcode:want,count:1}]);
    }finally{await watch.close();}
  }
});
test('failure events retain fixed enums without exposing arbitrary error messages or stacks',()=>{
  const rows=[],events=new SafeEvents(row=>rows.push(row)),secret='incapable-secret-in-error';
  events.event('verifier','fault',0,new Error('HOLD',{cause:new Error(secret)}));
  events.event('verifier','fault',0,new Error(secret));
  events.event('verifier','fault',0,{message:'OLD_CPU'});
  const cycle=new Error('FAIL');cycle.cause=cycle;events.event('verifier','fault',0,cycle);
  events.event('verifier','fault',0,new Error('FAIL',{cause:new Error('OK')}));
  assert.deepEqual(rows.map(row=>row.errcode),['HOLD','UNKNOWN','UNKNOWN','FAIL','FAIL']);
  assert.equal(JSON.stringify(rows).includes(secret),false);assert.equal(rows.some(row=>'stack' in row||'cause' in row||'message' in row),false);
});
test('runtime failure evidence preserves fixed admission and protocol failures',()=>{
  const rows=[],runtime=new proof.Runtime(contract(),new Budget(1000));runtime.events=new SafeEvents(row=>rows.push(row));
  const codes=['ADMIN','AUX_CGROUP','BODY','BODY_LIMIT','CANCELLED','DENIAL','HOST','HTTP','IDENTITY','IMAGE','INCAPABLE','JOIN','JWT','LOG_ADMISSION','LOG_DRIVER','LOG_FILE','LOGOUT','MEMBERSHIP','MOUNTS','OPENID','OUTPUT_LIMIT','PERMISSIONS','PERSISTENCE','PLATFORM','PORT','SFU','SFU_URL','SIGNAL','START','SWAP','TEMPLATE','TRACKS','TTL','WRONG_SUBJECT'];
  for(const code of codes)runtime.recordFailure(new Error(code));
  assert.deepEqual(rows.map(row=>row.errcode),codes);
  for(const [check,want] of [
    [()=>proof.assertPinnedImage({Os:'linux',Architecture:'arm64',RepoDigests:[PINS.synapse.image]},'synapse'),'IMAGE'],
    [()=>{const c=contract(),i=configuredContainer(c,'caddy');i.HostConfig.PortBindings={};proof.assertContainerConfiguration(i,c,'caddy');},'PORT'],
    [()=>{const c=contract(),i=configuredContainer(c,'synapse');i.Mounts[0].Source='/other';proof.assertContainerConfiguration(i,c,'synapse');},'MOUNTS'],
    [()=>validateContract({...contract(),logging:{}}),'LOG_ADMISSION']
  ]){let failure;try{check();}catch(error){failure=error;}assert.ok(failure instanceof Error);runtime.recordFailure(failure);assert.equal(rows.at(-1).errcode,want);}
  runtime.recordFailure(new Error('PERMISSIONS incapable-secret'));
  assert.equal(rows.at(-1).errcode,'UNKNOWN');assert.equal(JSON.stringify(rows).includes('incapable-secret'),false);
});
test('startup readiness retains changing request failures and HTTP status before eventual success',async()=>{
  const rows=[],budget=new Budget(2000),deadline=budget.end,runtime=new proof.Runtime(contract(),budget);runtime.events=new SafeEvents(row=>rows.push(row));
  const failures=[new Error('CONNECTION'),new Error('TLS'),Object.assign(new Error('HTTP',{cause:new Error('incapable-secret')}),{status:503}),Object.assign(new Error('HTTP'),{status:503})];let attempts=0;
  runtime.api=async(route,options,current)=>{assert.equal(route,'/_matrix/client/versions');assert.deepEqual(options,{});assert.equal(current,budget);const error=failures[attempts++];if(error)throw error;return {};};
  assert.equal(typeof runtime.waitReady,'function');await runtime.waitReady(budget);
  assert.deepEqual(rows,[{service:'verifier',event:'readiness',status:0,errcode:'CONNECTION',count:1},
    {service:'verifier',event:'readiness',status:0,errcode:'TLS',count:2},
    {service:'verifier',event:'readiness',status:503,errcode:'HTTP',count:3},
    {service:'verifier',event:'readiness',status:200,errcode:'OK',count:5}]);
  assert.equal(budget.end,deadline);assert.equal(JSON.stringify(rows).includes('incapable-secret'),false);
});
test('readiness TLS evidence survives a subsequent baseline abort without extending the deadline',async()=>{
  const c=contract(),rows=[],budget=new Budget(1000),deadline=budget.end,runtime=new proof.Runtime(c,budget);runtime.events=new SafeEvents(row=>rows.push(row));let broken=false;
  const watch=new proof.ResourceWatch(async()=>{if(broken)proof.assertHostBaseline(c,{freeMemory:3000000000,load:3,freeDisk:4000000000});},budget,1000);runtime.monitor=watch;
  runtime.api=async()=>{broken=true;await watch.sample().catch(()=>{});throw new Error('TLS');};
  assert.equal(typeof runtime.waitReady,'function');
  try{await assert.rejects(runtime.waitReady(budget),error=>{runtime.recordFailure(error);return error.message==='HOLD';});}
  finally{await watch.close(new Budget(1000));}
  assert.deepEqual(rows.slice(0,2).map(({event,errcode})=>({event,errcode})),[{event:'readiness',errcode:'TLS'},{event:'fault',errcode:'BASELINE_LOAD'}]);
  assert.equal(rows.some(row=>row.event==='readiness'&&row.errcode==='OK'),false);assert.equal(budget.end,deadline);
});
test('shared service restart, PID reuse and cgroup identity drift cannot pass measurement admission',async()=>{
  const c=contract();
  const io={show:async row=>({ActiveState:'active',SubState:'running',MainPID:String(row.pid),InvocationID:row.invocationId,ControlGroup:row.cgroup.slice('/sys/fs/cgroup'.length)}),read:file=>file.endsWith('/cmdline')?(file.includes('/100/')?'dockerd\0':'containerd\0'):file.endsWith('/stat')?'100 (daemon name) S '+'0 '.repeat(18)+'1000':'0::'+c.sharedRuntime.services.find(row=>file.includes('/'+row.pid+'/')).cgroup.slice('/sys/fs/cgroup'.length),stat:group=>({ino:c.sharedRuntime.services.find(row=>row.cgroup===group).inode,isDirectory:()=>true,isSymbolicLink:()=>false}),realpath:group=>group};
  await assert.doesNotReject(proof.sharedServiceRows(c,new Budget(1000),io));
  for(const change of [state=>state.InvocationID='f'.repeat(32),state=>state.MainPID='999',state=>state.ControlGroup='/system.slice/other.service'])await assert.rejects(proof.sharedServiceRows(c,new Budget(1000),{...io,show:async row=>{const state=await io.show(row);change(state);return state;}}));
  await assert.rejects(proof.sharedServiceRows(c,new Budget(1000),{...io,read:file=>file.endsWith('/stat')?'100 (daemon name) S '+'0 '.repeat(18)+'2000':io.read(file)}));
  await assert.rejects(proof.sharedServiceRows(c,new Budget(1000),{...io,stat:group=>({...io.stat(group),ino:999})}));
});
test('serialized resource sampling latches a mid-verification fault, aborts work and leaves no timer or reset deadline',async()=>{
  const budget=new Budget(2000);let active=0,maxActive=0,samples=0;const watch=new proof.ResourceWatch(async()=>{active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,10));active--;if(++samples===2)throw Error('FAIL');},budget,5);const deadline=budget.end;
  await watch.start();const pending=watch.sample();await assert.rejects(pending,/FAIL/);assert.equal(watch.controller.signal.aborted,true);assert.throws(()=>budget.remaining(),/FAIL/);assert.throws(()=>watch.check(),/FAIL/);await watch.close();assert.equal(maxActive,1);assert.equal(watch.timer,null);assert.equal(watch.pending,null);assert.equal(budget.end,deadline);
  const calls=samples;await new Promise(resolve=>setTimeout(resolve,20));assert.equal(samples,calls);
});
test('resource failure during cleanup cannot stop old containers or prevent receipt-owned stops',async()=>{
  const c=contract(),r=receipt(c),states=new Map(r.containers.map(row=>[row.id,inspected(c,row)])),stopped=[];let samples=0;
  const result=await stopOwned(c,r,new Budget(1000),{machine:()=>r.machineUuid,sample:async()=>{samples++;throw Error('FAIL');},inspect:async id=>structuredClone(states.get(id)),stop:async id=>{stopped.push(id);states.get(id).State.Running=false;states.get(id).State.Pid=0;}});
  assert.equal(result,'FAIL');assert.equal(samples>0,true);assert.deepEqual(new Set(stopped),new Set(r.containers.map(row=>row.id)));assert.equal(stopped.includes(c.baseline[0].id),false);
});
test('cleanup hook retains the baseline reason even after all four owned containers stop',async()=>{
  const c=contract(),r=receipt(c),states=new Map(r.containers.map(row=>[row.id,inspected(c,row)])),stopped=[],rows=[],events=new SafeEvents(row=>rows.push(row)),budget=new Budget(60000),deadline=budget.end;let postCheck=false;
  const recovery={machine:()=>c.machineUuid,inspect:async id=>structuredClone(states.get(id)),stop:async id=>{stopped.push(id);states.get(id).State.Running=false;states.get(id).State.Pid=0;},sample:async()=>proof.assertHostBaseline(c,{freeMemory:3000000000,load:3,freeDisk:4000000000})};
  assert.equal(typeof proof.cleanupHook,'function');
  await assert.rejects(proof.cleanupHook(c,events,{admit:()=>{},acquireBudget:()=>budget,readReceipt:()=>r,recovery,checkBaseline:async()=>{postCheck=true;}}),/^Error: UNKNOWN$/);
  assert.deepEqual(new Set(stopped),new Set(r.containers.map(row=>row.id)));assert.ok([...states.values()].every(row=>!row.State.Running));
  assert.equal(rows.filter(row=>row.event==='cleanup_sample'&&row.errcode==='BASELINE_LOAD').length,8);
  assert.equal(rows.filter(row=>row.event==='cleanup_sample').every(row=>row.service==='verifier'),true);
  assert.ok(rows.some(row=>row.event==='baseline_actual'&&row.count===3000));assert.ok(rows.some(row=>row.event==='baseline_limit'&&row.count===2000));
  assert.deepEqual(rows.at(-1),{service:'verifier',event:'cleanup_result',status:0,errcode:'UNKNOWN',count:1});
  assert.equal(postCheck,false);assert.equal(budget.end,deadline);
});
test('cleanup hook identifies final baseline failure separately from successful physical stops',async()=>{
  const c=contract(),r=receipt(c),rows=[],events=new SafeEvents(row=>rows.push(row));
  const recovery={machine:()=>c.machineUuid,inspect:async id=>({...inspected(c,r.containers.find(row=>row.id===id)),State:{Running:false,Pid:0,Paused:false}})};
  await assert.rejects(proof.cleanupHook(c,events,{admit:()=>{},acquireBudget:()=>new Budget(60000),readReceipt:()=>r,recovery,checkBaseline:async()=>proof.assertHostBaseline(c,{freeMemory:1000,load:0,freeDisk:4000000000})}),/^Error: BASELINE$/);
  assert.equal(rows[0].event,'cleanup_baseline');assert.equal(rows[0].errcode,'BASELINE_MEMORY');assert.equal(rows[1].count,1000);assert.equal(rows[2].count,2000000000);
});
test('cleanup failure evidence names the failed operation without blocking other owned stops',async()=>{
  const c=contract(),r=receipt(c),stopped=[],rows=[],events=new SafeEvents(row=>rows.push(row)),broken=r.containers[2].id;
  const recovery={machine:()=>c.machineUuid,inspect:async id=>({...inspected(c,r.containers.find(row=>row.id===id)),State:{Running:!stopped.includes(id),Pid:stopped.includes(id)?0:123,Paused:false}}),stop:async id=>{if(id===broken)throw new Error('COMMAND',{cause:new Error('incapable-secret')});stopped.push(id);}};
  await assert.rejects(proof.cleanupHook(c,events,{admit:()=>{},acquireBudget:()=>new Budget(60000),readReceipt:()=>r,recovery,checkBaseline:async()=>{}}),/^Error: UNKNOWN$/);
  assert.equal(stopped.length,3);assert.equal(stopped.includes(broken),false);
  assert.deepEqual(rows[0],{service:'auth',event:'cleanup_stop',status:0,errcode:'COMMAND',count:1});assert.equal(rows.at(-1).event,'cleanup_result');assert.equal(JSON.stringify(rows).includes('incapable-secret'),false);
});
test('cleanup diagnostics keep the original shared deadline and cannot trigger late stops',async()=>{
  const c=contract(),r=receipt(c),rows=[],events=new SafeEvents(row=>rows.push(row));let now=59995,stops=0;
  const budget=new Budget(60000,()=>0);budget.clock=()=>now;const deadline=budget.end;
  const recovery={machine:()=>c.machineUuid,inspect:async id=>{now+=10;return inspected(c,r.containers.find(row=>row.id===id));},stop:async()=>{stops++;}};
  await assert.rejects(proof.cleanupHook(c,events,{admit:()=>{},acquireBudget:()=>budget,readReceipt:()=>r,recovery,checkBaseline:async()=>{}}),/^Error: DEADLINE$/);
  assert.equal(stops,0);assert.equal(budget.end,deadline);assert.equal(now,60005);
  assert.deepEqual(rows.map(({event,errcode})=>({event,errcode})),[{event:'cleanup_inspect',errcode:'DEADLINE'},{event:'cleanup_result',errcode:'DEADLINE'}]);
});
test('cleanup hook records auxiliary admission and inherited-budget failures before any Docker operation',async()=>{
  for(const [stage,code] of [['cleanup_admission','SWAP'],['cleanup_budget','DEADLINE']]){
    const rows=[],events=new SafeEvents(row=>rows.push(row));let acquired=0,reads=0,mutations=0;
    const io={admit:()=>{if(stage==='cleanup_admission')throw new Error(code);},acquireBudget:()=>{acquired++;throw new Error(code);},readReceipt:()=>{reads++;},recovery:{stop:async()=>{mutations++;}}};
    await assert.rejects(proof.cleanupHook(contract(),events,io),error=>error.message===code);
    assert.deepEqual(rows,[{service:'verifier',event:stage,status:0,errcode:code,count:1}]);assert.equal(acquired,stage==='cleanup_budget'?1:0);assert.equal(reads,0);assert.equal(mutations,0);
  }
});
test('a failed cleanup evidence writer cannot prevent remaining owned stops or clear the failure',async()=>{
  const c=contract(),r=receipt(c),stopped=[];
  const recovery={machine:()=>c.machineUuid,inspect:async id=>({...inspected(c,r.containers.find(row=>row.id===id)),State:{Running:!stopped.includes(id),Pid:stopped.includes(id)?0:123,Paused:false}}),stop:async id=>stopped.push(id),sample:async()=>{throw new Error('FAIL');}};
  assert.equal(await stopOwned(c,r,new Budget(60000),recovery,()=>{throw new Error('incapable-secret');}),'FAIL');
  assert.deepEqual(new Set(stopped),new Set(r.containers.map(row=>row.id)));
});
test('a latched resource fault cancels a real verifier child and prohibits subsequent commands and VERIFIED',async()=>{
  const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');let samples=0,closed=false;const budget=new Budget(2000),deadline=budget.end,watch=new proof.ResourceWatch(async()=>{if(++samples===2)throw Error('FAIL');},budget,1000);
  await watch.start();const result=command(process.execPath,[fileURLToPath(import.meta.url),'--fixture','hold',String(server.address().port)],{budget}).catch(error=>error);const [socket]=await once(server,'connection');socket.on('error',()=>{});socket.once('close',()=>{closed=true;});const [data]=await once(socket,'data'),pid=Number(data.toString());
  try{await assert.rejects(watch.sample(),/FAIL/);assert.equal((await result).message,'FAIL');assert.throws(()=>process.kill(pid,0));await new Budget(500).waitFor(()=>closed);assert.throws(()=>command(process.execPath,[fileURLToPath(import.meta.url),'--fixture','idle'],{budget}),/FAIL/);let verified=false;try{watch.check();verified=true;}catch{}assert.equal(verified,false);assert.equal(budget.end,deadline);}
  finally{await watch.close();socket.destroy();server.close();}assert.equal(watch.timer,null);assert.equal(watch.pending,null);
});
test('resource failure aborts an actual pending HTTP request before the client timeout',async()=>{
  const server=http.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');let count=0;const budget=new Budget(2000),watch=new proof.ResourceWatch(async()=>{if(++count===2)throw Error('FAIL');},budget,1000);await watch.start();
  const observed=once(server,'request'),result=httpRequest(`http://127.0.0.1:${server.address().port}`,{allowHttpFixture:true,signal:budget.signal,timeout:2000}).catch(error=>error);const [request]=await observed;let closed=false;request.socket.once('close',()=>{closed=true;});
  try{await assert.rejects(watch.sample(),/FAIL/);assert.equal((await result).message,'NETWORK');await new Budget(500).waitFor(()=>closed);}finally{await watch.close();server.closeAllConnections();server.close();}
});
test('failure evidence preserves the resource reason after real HTTP cancellation',async()=>{
  const server=http.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');let count=0;const budget=new Budget(2000),watch=new proof.ResourceWatch(async()=>{if(++count===2)throw new Error('FAIL',{cause:new Error('SHARED_CPU')});},budget,1000);await watch.start();
  const observed=once(server,'request'),result=httpRequest(`http://127.0.0.1:${server.address().port}`,{allowHttpFixture:true,signal:budget.signal,timeout:2000}).catch(error=>error);const [request]=await observed;let closed=false;request.socket.once('close',()=>{closed=true;});
  try{
    await assert.rejects(watch.sample(),/FAIL/);const error=await result;assert.equal(error.message,'NETWORK');await new Budget(500).waitFor(()=>closed);
    const rows=[],runtime=new proof.Runtime(contract(),budget);runtime.monitor=watch;runtime.events=new SafeEvents(row=>rows.push(row));runtime.recordFailure(error);
    assert.deepEqual(rows,[{service:'verifier',event:'fault',status:0,errcode:'SHARED_CPU',count:1}]);
  }finally{await watch.close();server.closeAllConnections();server.close();}
});
test('normal sampler shutdown waits for its outstanding real child without creating a resource fault or leaving work',async()=>{
  const server=net.createServer();server.listen(0,'127.0.0.1');await once(server,'listening');let calls=0,closed=false;const budget=new Budget(2000),watch=new proof.ResourceWatch(async current=>{if(++calls===2)await command(process.execPath,[fileURLToPath(import.meta.url),'--fixture','hold',String(server.address().port)],{budget:current});},budget,1000);await watch.start();const sampling=watch.sample();const [socket]=await once(server,'connection');socket.on('error',()=>{});socket.once('close',()=>{closed=true;});const [data]=await once(socket,'data'),pid=Number(data.toString());
  try{await watch.close();await sampling;assert.throws(()=>process.kill(pid,0));await new Budget(500).waitFor(()=>closed);assert.doesNotThrow(()=>watch.check());assert.equal(watch.timer,null);assert.equal(watch.pending,null);}finally{socket.destroy();server.close();}
});
test('shutdown cannot erase a measurement fault already produced by its outstanding sample',async()=>{
  let calls=0,release;const watch=new proof.ResourceWatch(async()=>{if(++calls===2){await new Promise(resolve=>{release=resolve;});throw Error('FAIL');}},new Budget(1000),500);await watch.start();const sampling=watch.sample(),closing=watch.close();release();await closing;await assert.rejects(sampling,/FAIL/);assert.throws(()=>watch.check(),/FAIL/);assert.equal(watch.pending,null);assert.equal(watch.timer,null);
});
test('Runtime stop freezes cleanup deadline before watcher shutdown and prevents any later mutation or VERIFIED',async()=>{
  let now=0,mutations=0,verified=false;const budget=new Budget(60000,()=>now),runtime={cleanup:budget,monitor:{close:async received=>{assert.equal(received,budget);now+=60001;received.remaining();}},connections:[{socket:{close:()=>{mutations++;}}}]};
  await assert.rejects(proof.Runtime.prototype.stop.call(runtime).then(()=>{verified=true;}),/DEADLINE/);assert.equal(mutations,0);assert.equal(verified,false);assert.equal(budget.end,60000);
});
test('watcher pending work is bounded by the same consumed cleanup deadline',async()=>{
  let calls=0;const watch=new proof.ResourceWatch(async()=>{if(++calls===2)await new Promise(resolve=>setTimeout(resolve,100));},new Budget(1000),500);await watch.start();const pending=watch.sample(),cleanup=new Budget(40);await assert.rejects(watch.close(cleanup),/DEADLINE/);await pending;assert.equal(watch.pending,null);assert.equal(watch.timer,null);
});
test('watcher shutdown consumption is not reset before receipt-owned cleanup mutations',async()=>{
  let now=0,mutations=0;const c=contract(),r=receipt(c),budget=new Budget(60000,()=>now),watch=new proof.ResourceWatch(async()=>{},new Budget(120000),500);await watch.start();const closing=watch.close(budget);now=100;await closing;
  const result=await stopOwned(c,r,budget,{machine:()=>r.machineUuid,inspect:async id=>{now+=59950;return inspected(c,r.containers.find(row=>row.id===id));},stop:async()=>{mutations++;}});assert.equal(result,'DEADLINE');assert.equal(mutations,0);assert.equal(budget.end,60000);
});

test('new synthetic persistence and logging exceptions require frozen paths, permissions, accessors and every fault boundary',()=>{
  assert.doesNotThrow(()=>validateContract(contract()));
  for(const key of ['persistence','logging','nodeSha256']){const c=contract();delete c[key];assert.throws(()=>validateContract(c));}
  for(const change of [{persistence:{corePattern:'core',locations:[]}},{logging:{coverage:['success'],bypasses:[]}},{auxiliary:{...contract().auxiliary,unit:'system.slice'}}]) assert.throws(()=>validateContract({...contract(),...change}));
});
test('aggregate signed fault coverage requires five real boundaries without making redirect an additional prerequisite',()=>{
  const c=contract();c.logging.coverage=['success','timeout','tls','connection','handshake'];
  assert.doesNotThrow(()=>validateContract(c));
  c.logging.coverage.splice(2,1);assert.throws(()=>validateContract(c),/LOG_ADMISSION/);
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
function inspected(c,row){return {Id:row.id,Image:row.imageId,Created:row.created,State:{Running:true,Pid:123,Paused:false},Config:{Image:row.image,Labels:{'com.docker.compose.project':c.project,'com.docker.compose.service':row.service,'rtc.run':c.runId,'rtc.host':c.host}}};}
test('cleanup uses receipt ownership and fresh checks without depending on a controller PID', async () => {
  const c=contract(),r=receipt(c);let now=0;const stopped=[];const states=new Map(r.containers.map(x=>[x.id,inspected(c,x)]));states.get(r.containers[1].id).Config.Labels['rtc.run']='another-run';
  const io={machine:()=>r.machineUuid,inspect:async(id,b)=>{b.remaining();return structuredClone(states.get(id));},stop:async(id,b)=>{b.remaining();stopped.push(id);states.get(id).State.Running=false;states.get(id).State.Pid=0;}};
  const result=await stopOwned(c,r,new Budget(60000,()=>now),io);assert.equal(result,'UNKNOWN');assert.equal(stopped.length,3);assert.equal(stopped.includes(r.containers[1].id),false);
  assert.equal(states.get(r.containers[1].id).State.Running,true);
});
test('receipt recovery unpauses only its paused Synapse before stopping and rechecks identity within the same deadline',async()=>{
  const c=contract(),r=receipt(c),states=new Map(r.containers.map(row=>[row.id,inspected(c,row)])),paused=r.containers[0].id,mutations=[],budget=new Budget(1000);
  states.get(paused).State.Paused=true;
  const io={machine:()=>r.machineUuid,inspect:async id=>structuredClone(states.get(id)),unpause:async(id,current)=>{assert.equal(current,budget);assert.equal(id,paused);mutations.push('unpause');states.get(id).State.Paused=false;},stop:async(id,current)=>{assert.equal(current,budget);assert.notEqual(states.get(id).State.Paused,true);mutations.push(id);states.get(id).State.Running=false;states.get(id).State.Pid=0;}};
  assert.equal(await stopOwned(c,r,budget,io),'OK');assert.ok(mutations.indexOf('unpause')<mutations.indexOf(paused));
  states.get(paused).State.Running=true;states.get(paused).State.Paused=true;mutations.length=0;
  io.unpause=async()=>{mutations.push('unpause');states.get(paused).Created='replacement';states.get(paused).State.Paused=false;};
  assert.equal(await stopOwned(c,r,new Budget(1000),{...io,stop:async id=>mutations.push(id)}),'UNKNOWN');assert.equal(mutations.includes(paused),false);
});
test('slow Docker inspections exhaust one stop deadline without starting late mutations', async () => {
  const c=contract(),r=receipt(c);let now=0;const states=new Map(r.containers.map(x=>[x.id,inspected(c,x)]));const stopped=[];
  const io={machine:()=>r.machineUuid,inspect:async(id,b)=>{now+=9000;b.remaining();return structuredClone(states.get(id));},stop:async(id,b)=>{b.remaining();stopped.push(id);states.get(id).State.Running=false;states.get(id).State.Pid=0;}};
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
  const c=contract(),r=receipt(c),states=new Map(r.containers.map(row=>[row.id,inspected(c,row)])),stopped=[],unpaused=[];states.get(r.containers[0].id).State.Paused=true;
  const delayed=async(value,budget)=>JSON.parse(await command(process.execPath,[fileURLToPath(import.meta.url),'--fixture','json',JSON.stringify(value)],{budget}));
  const io={machine:()=>r.machineUuid,inspect:(id,budget)=>delayed(states.get(id),budget),unpause:async(id,budget)=>{await delayed({status:'unpaused'},budget);unpaused.push(id);states.get(id).State.Paused=false;},stop:async(id,budget)=>{assert.notEqual(states.get(id).State.Paused,true);await delayed({status:'stopped'},budget);stopped.push(id);states.get(id).State.Running=false;states.get(id).State.Pid=0;}};
  assert.equal(await stopOwned(c,r,new Budget(5000),io),'OK');assert.equal(stopped.length,4);assert.deepEqual(unpaused,[r.containers[0].id]);assert.ok([...states.values()].every(i=>!i.State.Running));
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
test('observed markers distinguish permitted auth stderr RAM from forbidden streams and retained output across chunks',()=>{
  const marker='incapable/a"b',rows=[],allowed=new SafeEvents(row=>rows.push(row));
  assert.equal(typeof allowed.watch,'function');allowed.watch(marker);
  for(const chunk of ['incapable%2','Fa%22b','incapable\\u002','fa\\"b'])allowed.consume('auth',Buffer.from(chunk),'stderr');
  assert.doesNotThrow(()=>allowed.check());assert.ok(allowed.observed>=2);
  for(const [service,stream] of [['caddy','stderr'],['synapse','stdout'],['auth','stdout']]){
    const events=new SafeEvents(row=>rows.push(row));events.watch(marker);
    events.consume(service,Buffer.from('incapable%2'),stream);events.consume(service,Buffer.from('Fa%22b'),stream);
    assert.throws(()=>events.check(),/LEAK/);
  }
  allowed.consume('auth',Buffer.from('incapable/a"b'),'retained');assert.throws(()=>allowed.check(),/LEAK/);
  allowed.event('verifier','scan',0,'FAIL',allowed.observed);assert.equal(JSON.stringify(rows).includes('incapable'),false);
  const bounded=new SafeEvents(()=>{});bounded.watch(marker);bounded.consume('auth',Buffer.from('x'.repeat(100000)),'stderr');
  assert.ok(bounded.bufferedBytes<=65536);
});
test('actual retained files are scanned across read boundaries and oversized or opaque files remain HOLD',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'babacom-rtc-log-')),file=path.join(directory,'retained.txt'),budget=new Budget(1000),events=new SafeEvents(()=>{});
  try{
    assert.equal(typeof events.inspectFile,'function');events.watch('incapable/retained');
    fs.writeFileSync(file,'safe event\n');events.inspectFile(file,budget);assert.doesNotThrow(()=>events.check());
    fs.writeFileSync(file,'x'.repeat(8190)+'incapable%2Fretained');events.inspectFile(file,budget);assert.throws(()=>events.check(),/LEAK/);
    fs.writeFileSync(file,Buffer.from([0,1,2]));assert.throws(()=>new SafeEvents(()=>{}).inspectFile(file,budget),/HOLD/);
    fs.writeFileSync(file,Buffer.alloc(1048577,120));assert.throws(()=>new SafeEvents(()=>{}).inspectFile(file,budget),/HOLD/);
  }finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(directory);}
});
function syslogFixture(content='historical\n'){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'babacom-rtc-syslog-')),file=path.join(directory,'syslog');fs.writeFileSync(file,content);const stat=fs.lstatSync(file),parent={uid:0,gid:104,dev:stat.dev,ino:stat.ino,mode:0o40775,isDirectory:()=>true,isSymbolicLink:()=>false};
  const io={...fs,lstatSync:name=>name==='/var'||name==='/var/log'?parent:fs.lstatSync(name==='/var/log/syslog'?file:name),openSync:(name,flags)=>{assert.equal(name,'/var/log/syslog');return fs.openSync(file,flags);}};
  const runtime={c:{logging:{bypasses:[{path:'/var/log/syslog',kind:'file',uid:stat.uid,gid:stat.gid,mode:stat.mode&0o777}]}},events:new SafeEvents(()=>{}),...Object.fromEntries(['freezeSyslog','scanSyslog','closeSyslog'].map(name=>[name,proof.Runtime.prototype[name]]))};
  return {runtime,io,file,directory,dispose:()=>{runtime.closeSyslog?.();for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);}};
}
test('exact syslog observation starts at frozen EOF and preserves split markers across monotonic scans',()=>{
  const fixture=syslogFixture('old'.repeat(400000)),{runtime,io,file}=fixture,budget=new Budget(1000);runtime.events.watch('incapable/syslog');
  try{
    runtime.freezeSyslog(budget,io);runtime.scanSyslog(budget);assert.equal(runtime.events.bytes,0);
    fs.appendFileSync(file,'incapable%2Fsys');runtime.scanSyslog(budget);const bytes=runtime.events.bytes;runtime.scanSyslog(budget);assert.equal(runtime.events.bytes,bytes);
    runtime.events.consume('verifier',Buffer.from('unrelated retained file'),'retained');fs.appendFileSync(file,'log');assert.throws(()=>runtime.scanSyslog(budget),/LEAK/);
  }finally{fixture.dispose();}
});
test('syslog concurrent append cannot admit credentials or sign off exit beyond the captured EOF',async()=>{
  for(const phase of ['admission','exit']){
    const fixture=syslogFixture(),{runtime,io,file}=fixture,budget=new Budget(1000);runtime.events.watch('incapable/syslog');runtime.loggingAdmitted=false;let signedOff=false;
    try{
      runtime.freezeSyslog(budget,io);const offset=runtime.syslog.offset;fs.appendFileSync(file,'safe\n');let appended=false;io.readSync=(...args)=>{const count=fs.readSync(...args);if(!appended){appended=true;fs.appendFileSync(file,'incapable/syslog');}return count;};
      assert.throws(()=>{runtime.scanSyslog(budget);if(phase==='admission')runtime.loggingAdmitted=true;else runtime.closeSyslog();signedOff=true;},/^Error: HOLD$/);
      assert.equal(runtime.syslog.offset,offset);assert.equal(runtime.loggingAdmitted,false);assert.equal(signedOff,false);await assert.rejects(proof.Runtime.prototype.register.call(runtime,'rtc-a',budget),/LOG_ADMISSION/);
      assert.throws(()=>runtime.scanSyslog(budget),/LEAK/);
    }finally{fixture.dispose();}
  }
});
test('syslog rotation, truncation, metadata drift, unreadability and oversized or opaque appends stay HOLD',()=>{
  for(const fault of ['rotate','truncate','metadata','parent','unreadable','oversize','opaque']){
    const fixture=syslogFixture(),{runtime,io,file}=fixture,budget=new Budget(1000);
    try{
      runtime.freezeSyslog(budget,io);
      if(fault==='rotate'){fs.renameSync(file,file+'.1');fs.writeFileSync(file,'replacement');}
      if(fault==='truncate')fs.truncateSync(file,0);
      if(fault==='metadata'){const read=io.lstatSync;io.lstatSync=name=>{const stat=read(name);return name==='/var/log/syslog'?{...stat,uid:stat.uid+1,isFile:()=>true,isSymbolicLink:()=>false}:stat;};}
      if(fault==='parent'){const read=io.lstatSync;io.lstatSync=name=>{const stat=read(name);return name==='/var/log'?{...stat,gid:stat.gid+1}:stat;};}
      if(fault==='unreadable')io.readSync=()=>{throw Error('raw private filesystem error');};
      if(fault==='oversize')fs.appendFileSync(file,Buffer.alloc(1048577,120));
      if(fault==='opaque')fs.appendFileSync(file,Buffer.from([0,1]));
      if(fault==='unreadable')fs.appendFileSync(file,'new');
      assert.throws(()=>runtime.scanSyslog(budget),/^Error: HOLD$/);
    }finally{fixture.dispose();}
  }
});
test('syslog deadline and partial freeze failures close descriptors without advancing the captured cursor',async()=>{
  const fixture=syslogFixture(),{runtime,io,file}=fixture;let now=0,opened;
  try{
    const budget=new Budget(1000,()=>now);runtime.freezeSyslog(budget,io);const fd=runtime.syslog.fd,offset=runtime.syslog.offset;fs.appendFileSync(file,'safe\n');
    io.readSync=(...args)=>{const count=fs.readSync(...args);now=1001;return count;};assert.throws(()=>runtime.scanSyslog(budget),/^Error: DEADLINE$/);assert.equal(runtime.syslog.offset,offset);
    runtime.cleanup=budget;await assert.rejects(proof.Runtime.prototype.stop.call(runtime),/^Error: DEADLINE$/);assert.equal(runtime.syslog,null);assert.throws(()=>fs.fstatSync(fd));
    now=0;const open=io.openSync;io.openSync=(...args)=>{opened=open(...args);return opened;};io.fstatSync=()=>{throw Error('raw private filesystem error');};assert.throws(()=>runtime.freezeSyslog(budget,io),/^Error: HOLD$/);assert.throws(()=>fs.fstatSync(opened));
  }finally{fixture.dispose();}
});
test('syslog descriptor closes even when cleanup budget acquisition fails before stop work',async()=>{
  const fixture=syslogFixture(),{runtime,io}=fixture;
  try{runtime.freezeSyslog(new Budget(1000),io);const fd=runtime.syslog.fd;Object.defineProperty(runtime,'cleanup',{get:()=>{throw Error('HOLD');}});await assert.rejects(proof.Runtime.prototype.stop.call(runtime),/^Error: HOLD$/);assert.throws(()=>fs.fstatSync(fd));}
  finally{fixture.dispose();}
});
test('newly returned secrets are checked against bounded already observed stream tails',()=>{
  const events=new SafeEvents(()=>{});events.consume('caddy',Buffer.from('incapable%2Freturned'),'stderr');events.watch('incapable/returned');assert.throws(()=>events.check(),/LEAK/);
});
test('discarded unknown output cannot falsely pass a newly issued secret while allowed auth RAM remains separate',()=>{
  const marker='incapable/newly-issued',padding='x'.repeat(100000);
  for(const [service,stream] of [['caddy','stderr'],['synapse','stdout'],['auth','stdout']]){
    const events=new SafeEvents(()=>{});events.consume(service,Buffer.from(marker+padding),stream);
    assert.throws(()=>events.watch(marker),/HOLD/);assert.ok(events.bufferedBytes<=65536);
  }
  const allowed=new SafeEvents(()=>{});allowed.consume('auth',Buffer.from(marker+padding),'stderr');assert.doesNotThrow(()=>allowed.watch(marker));
  const known=new SafeEvents(()=>{});known.watch(marker);known.consume('caddy',Buffer.from(padding),'stderr');assert.doesNotThrow(()=>known.watch(marker));
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
test('real requests distinguish refused connection, untrusted TLS and client deadline without raw errors',async()=>{
  const certificate=memoryTlsCertificate(),server=https.createServer(certificate,()=>{});server.on('tlsClientError',()=>{});
  server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
  try{await assert.rejects(httpRequest(`https://127.0.0.1:${port}`,{timeout:500}),/^Error: TLS$/);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await assert.rejects(httpRequest(`https://127.0.0.1:${port}`,{timeout:500}),/^Error: CONNECTION$/);
  const hanging=http.createServer(()=>{});hanging.listen(0,'127.0.0.1');await once(hanging,'listening');
  try{await assert.rejects(httpRequest(`http://127.0.0.1:${hanging.address().port}`,{timeout:40,allowHttpFixture:true}),/^Error: DEADLINE$/);}finally{hanging.closeAllConnections();await new Promise(resolve=>hanging.close(resolve));}
});
test('actual readiness requests retain strict TLS rejection until the inherited startup deadline',async()=>{
  const certificate=memoryTlsCertificate(),rows=[];let requests=0;
  const server=https.createServer(certificate,(_request,response)=>{requests++;response.end('{}');});server.on('tlsClientError',()=>{});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const budget=new Budget(500),deadline=budget.end,runtime=new proof.Runtime({domain:'localhost',port:server.address().port},budget);runtime.events=new SafeEvents(row=>rows.push(row));
  try{
    await assert.rejects(runtime.waitReady(budget),/^Error: DEADLINE$/);
    assert.equal(requests,0);assert.equal(budget.end,deadline);
    assert.deepEqual(rows,[{service:'verifier',event:'readiness',status:0,errcode:'TLS',count:1}]);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('actual readiness records a trusted HTTPS 503 before the Matrix versions endpoint becomes ready',async()=>{
  const certificate=memoryTlsCertificate(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'babacom-rtc-ready-')),file=path.join(directory,'fixture-ca.pem');let requests=0;
  fs.writeFileSync(file,certificate.cert);
  const server=https.createServer(certificate,(request,response)=>{assert.equal(request.url,'/_matrix/client/versions');assert.equal(request.headers.authorization,undefined);requests++;response.writeHead(requests<3?503:200);response.end(requests<3?'incapable-secret':'{}');});server.on('tlsClientError',()=>{});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--fixture','readiness',`https://localhost:${server.address().port}`],{env:{...process.env,NODE_EXTRA_CA_CERTS:file},stdio:['ignore','pipe','pipe']});let output='',stderr='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);const [code]=await once(child,'close');
    assert.equal(code,0);assert.equal(stderr,'');assert.equal(requests,3);const rows=output.trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(rows.filter(row=>row.event==='readiness'),[{service:'verifier',event:'readiness',status:503,errcode:'HTTP',count:1},{service:'verifier',event:'readiness',status:200,errcode:'OK',count:3}]);
    assert.equal(output.includes('incapable-secret'),false);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.unlinkSync(file);fs.rmdirSync(directory);}
});
test('strict additional hostname rejection uses the approved SNI on an actual trusted HTTPS fixture',async()=>{
  const certificate=memoryTlsCertificate(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'babacom-rtc-tls-')),file=path.join(directory,'fixture-ca.pem'),names=[];let requests=0;
  fs.writeFileSync(file,certificate.cert);
  const server=https.createServer({...certificate,SNICallback:(name,callback)=>{names.push(name);callback(null,tls.createSecureContext(certificate));}},(_request,response)=>{requests++;response.end('ok');});server.on('tlsClientError',()=>{});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const attempt=async(expected,url=`https://localhost:${server.address().port}`)=>{const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--fixture','hostname-check',url,expected],{env:{...process.env,NODE_EXTRA_CA_CERTS:file},stdio:['ignore','pipe','pipe']});let output='',stderr='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);const [code]=await once(child,'close');assert.equal(code,0);assert.equal(stderr,'');return JSON.parse(output);};
  try{assert.deepEqual(await attempt('localhost'),{status:200});assert.deepEqual(await attempt('incapable.invalid'),{errcode:'TLS'});assert.deepEqual(await attempt('localhost',`https://127.0.0.1:${server.address().port}`),{errcode:'TLS'});assert.equal(requests,1);assert.deepEqual(names,['localhost','localhost','localhost']);}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.unlinkSync(file);fs.rmdirSync(directory);}
});
test('stricter hostname probe cannot reuse a preceding positive HTTPS keepalive connection',async()=>{
  const certificate=memoryTlsCertificate(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'babacom-rtc-tls-')),file=path.join(directory,'fixture-ca.pem');let requests=0;
  fs.writeFileSync(file,certificate.cert);
  const server=https.createServer(certificate,(_request,response)=>{requests++;response.end('ok');});server.on('tlsClientError',()=>{});server.keepAliveTimeout=5000;
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try{
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--fixture','hostname-keepalive',`https://localhost:${server.address().port}`],{env:{...process.env,NODE_EXTRA_CA_CERTS:file},stdio:['ignore','pipe','pipe']});let output='',stderr='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);const [code]=await once(child,'close');
    assert.equal(code,0);assert.equal(stderr,'');assert.deepEqual(JSON.parse(output),[{status:200},{errcode:'TLS'}]);assert.equal(requests,1);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.unlinkSync(file);fs.rmdirSync(directory);}
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
  for(const message of ['UNKNOWN','BUSY','DEADLINE','FAIL','HOLD','BASELINE','BASELINE_LOAD','incapable-secret%2Fmarker\nraw stack/body']){
    const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'--fixture','public-error',message],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});
    const [code]=await once(child,'close');assert.equal(code,1);assert.equal(stdout,'');assert.deepEqual(JSON.parse(stderr),{service:'verifier',event:'command',errcode:['UNKNOWN','BUSY','DEADLINE','FAIL','HOLD'].includes(message)?message:'HOLD'});assert.equal(stderr.includes('incapable-secret'),false);assert.equal(stderr.includes('raw stack/body'),false);
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
