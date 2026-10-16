import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const ROOT='/opt/babacom-matrix-rtc-e1', PROJECT='babacom-matrix-rtc-e1';
const SERVICES=['synapse','livekit','auth','caddy'];
const SOURCE_FILES=['compose.yaml','homeserver.yaml.example','appservice-registration.yaml.example','livekit.yaml.example','Caddyfile','proof.mjs','proof.test.mjs'];
export const PINS=Object.freeze({
  synapse:{image:'ghcr.io/element-hq/synapse@sha256:43fd704aedef503a6fba2e5696439ef7bac24479a3472e364561973f550e4aad',source:'63dc0cbfe514f60743212566374ffeb5e9e295c2'},
  auth:{image:'ghcr.io/element-hq/lk-jwt-service@sha256:2c985ab98de8da3b101c09fb597404dcb2723bb984b1ee20a430a8bb4f6a51a9',source:'0e176b1eca44e67b11484d0bdf56999807bf2b8e'},
  livekit:{image:'docker.io/livekit/livekit-server@sha256:f63579e294b6dbf38e0e6151a24a5b425e9293e75e6d41959f470c957248b8a7',source:'0b3fd288e3ef3263ec475ba0d78cf3ad77459981'},
  caddy:{image:'docker.io/library/caddy@sha256:173b26306d711395accaeba8b67afcaad2a085ccb1e6bf26010bfe8c095a5229',source:'72dd0fb067f6d7826c7f79907670ba4a713bfe37'},
});
function requireFact(ok,code='CONTRACT'){if(!ok) throw new Error(code);}
export class Budget {
  constructor(ms){requireFact(Number.isFinite(ms)&&ms>0);this.end=performance.now()+ms;}
  remaining(cap=Infinity){const n=Math.min(this.end-performance.now(),cap);requireFact(n>0,'DEADLINE');return Math.ceil(n);}
}
export function validateContract(c){
  requireFact(c&&c.host==='lhins-af0ntal8'&&c.root===ROOT&&c.project===PROJECT);
  requireFact(c.approved===true&&c.logAdmission===true&&/^[a-f0-9]{32}$/.test(c.runId));
  requireFact(typeof c.domain==='string'&&/^(?=.{4,253}$)[a-z0-9]+(?:[-.][a-z0-9]+)*\.[a-z]{2,}$/.test(c.domain));
  requireFact(Number.isInteger(c.port)&&c.port>1024&&c.port<65536);
  requireFact(c.certificateSource==='operator-provisioned-public-chain'&&/^[a-f0-9]{64}$/.test(c.certificateSha256));
  requireFact(c.asHomeserver===c.domain&&JSON.stringify(c.fullAccessHomeservers)===JSON.stringify([c.domain]));
  requireFact(c.platform==='linux/amd64'&&JSON.stringify(c.source)===JSON.stringify(PINS));
  requireFact(c.sourceHashes&&Object.keys(c.sourceHashes).length===7&&SOURCE_FILES.every(name=>/^[a-f0-9]{64}$/.test(c.sourceHashes[name])));
  requireFact(Array.isArray(c.accessors)&&c.accessors.length>0&&c.accessors.every(x=>x==='operator-loopback'));
  requireFact(c.auxiliary&&/^\/sys\/fs\/cgroup\/[a-zA-Z0-9/_-]+$/.test(c.auxiliary.cgroup));
  requireFact(c.auxiliary.cpu>0&&c.auxiliary.cpu<=.2&&c.auxiliary.memory>0&&c.auxiliary.memory<=268435456);
  requireFact(c.thresholds&&['minFreeMemory','minFreeDisk','maxLoad','maxOldCpuPercent','maxOldMemoryGrowth'].every(k=>Number.isFinite(c.thresholds[k])&&c.thresholds[k]>0));
  requireFact(Array.isArray(c.baseline)&&c.baseline.length>0&&c.baseline.every(x=>/^[a-f0-9]{64}$/.test(x.id)&&typeof x.image==='string'&&x.status==='running'&&Array.isArray(x.mounts)));
  return c;
}
const EVENTS=new Set(['started','stopped','http','chunks','unknown','fault','gate','participants','resources','baseline','command','scan']);
const ERRORS=new Set(['OK','M_FORBIDDEN','M_UNAUTHORIZED','M_UNKNOWN_TOKEN','FAIL','HOLD','UNKNOWN','DEADLINE','CONTRACT','BUSY']);
export class SafeEvents {
  constructor(write){this.write=write;this.bytes=0;this.chunks=0;}
  consume(service,chunk){this.bytes+=chunk.length;this.chunks++;}
  event(service,event,status=0,errcode='OK',count=1){
    if(event==='chunks'&&this.chunks>1)return;
    this.write({service:SERVICES.includes(service)?service:'verifier',event:EVENTS.has(event)?event:'unknown',status:Number.isInteger(status)&&status>=0&&status<600?status:0,errcode:ERRORS.has(errcode)?errcode:'UNKNOWN',count:Number.isSafeInteger(count)&&count>=0?count:0});
  }
}
export function assertOwned(i,c,service){
  const l=i?.Config?.Labels;
  requireFact(/^[a-f0-9]{64}$/.test(i?.Id)&&SERVICES.includes(service)&&l?.['rtc.run']===c.runId&&l?.['rtc.host']===c.host&&l?.['com.docker.compose.project']===c.project&&l?.['com.docker.compose.service']===service&&i.Config.Image===PINS[service].image,'UNKNOWN');
}
export function assertResources(rows){
  requireFact(Array.isArray(rows)&&rows.length>0,'RESOURCES');
  requireFact(rows.every(x=>Number.isFinite(x.cpu)&&x.cpu>0&&Number.isSafeInteger(x.memory)&&x.memory>0),'RESOURCES');
  requireFact(rows.reduce((n,x)=>n+x.cpu,0)<=1.000000001&&rows.reduce((n,x)=>n+x.memory,0)<=1610612736,'RESOURCES');
}
export function redirectGuard(r){return r.status>=300&&r.status<400?{status:502,headers:{},body:Buffer.alloc(0)}:r;}
export function httpRequest(url,{method='GET',body,token,timeout=8000,allowHttpFixture=false,lookup,headers={}}={}){
  const u=new URL(url);requireFact((u.protocol==='https:'||(allowHttpFixture&&u.protocol==='http:'&&u.hostname==='127.0.0.1'))&&!u.username&&!u.password,'TLS');
  requireFact(timeout>0&&timeout<=10000,'DEADLINE');
  return new Promise((resolve,reject)=>{
    let size=0;const chunks=[];
    const req=(u.protocol==='https:'?https:http).request(u,{method,lookup,rejectUnauthorized:true,headers:{...headers,...(token?{Authorization:`Bearer ${token}`}:{})}},res=>{
      res.on('data',b=>{size+=b.length;if(size>1048576){req.destroy();reject(new Error('BODY_LIMIT'));}else chunks.push(b);});
      res.on('end',()=>{clearTimeout(timer);resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)});});
      res.on('error',()=>{clearTimeout(timer);reject(new Error('NETWORK'));});
    });
    const timer=setTimeout(()=>{req.destroy();reject(new Error('DEADLINE'));},timeout);
    req.on('error',()=>{clearTimeout(timer);reject(new Error('NETWORK'));});
    req.end(body);
  });
}
export async function transaction(send,terminate,{timeout=8000,limit=10000,budget=new Budget(limit)}={}){
  const start=performance.now();const remaining=budget.remaining(timeout);let timer;
  const outcome=await Promise.race([Promise.resolve().then(send).then(value=>({value}),()=>({failed:true})),new Promise(resolve=>{timer=setTimeout(()=>resolve({expired:true}),remaining);})]);
  clearTimeout(timer);
  if(!outcome.expired)return outcome.failed?{status:'FAIL',termination:'UNKNOWN'}:{status:'OK',value:outcome.value};
  let proof={};let killTimer;
  try{proof=await Promise.race([terminate(),new Promise(resolve=>{killTimer=setTimeout(()=>resolve({}),Math.max(1,Math.min(limit-(performance.now()-start),budget.remaining())));})]);}catch{}finally{clearTimeout(killTimer);}
  return {status:'FAIL',termination:proof.exit===true&&proof.attachEnd===true&&proof.upstreamClosed===true&&performance.now()-start<limit?'PROVED':'UNKNOWN'};
}
export function assertTicket(claims,e){
  requireFact(claims?.sub===e.subject&&claims.iss===e.key&&claims.exp>Date.now()/1000&&claims.exp<=Date.now()/1000+3610,'JWT');
  const v=claims.video;requireFact(v?.room===e.room&&v.roomJoin===true&&v.canPublish===true&&v.canSubscribe===true,'JWT');
  requireFact(Object.keys(v).every(k=>['room','roomJoin','canPublish','canSubscribe','canPublishData','canUpdateOwnMetadata','roomCreate','hidden','roomAdmin','roomList','roomRecord'].includes(k)),'JWT');
  requireFact(['roomAdmin','roomCreate','roomList','roomRecord','hidden'].every(k=>v[k]!==true),'JWT');
  requireFact(['canPublishData','canUpdateOwnMetadata'].every(k=>v[k]===undefined||v[k]===true),'JWT');
}
export function assertParticipants(actual,expected){
  requireFact(Array.isArray(actual)&&actual.length===expected.length&&actual.every(x=>expected.includes(x.identity)&&(x.tracks===undefined||(Array.isArray(x.tracks)&&x.tracks.length===0))),'TRACKS');
}

// Runtime errors are always converted to fixed enums at the command boundary.
function command(executable,args,{input,timeout=10000}={}){
  return new Promise((resolve,reject)=>{
    const p=spawn(executable,args,{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME}});const out=[];let size=0;
    const timer=setTimeout(()=>{p.kill('SIGKILL');reject(new Error('DEADLINE'));},timeout);
    p.stdout.on('data',b=>{size+=b.length;if(size>4194304){p.kill('SIGKILL');reject(new Error('OUTPUT_LIMIT'));}else out.push(b);});p.stderr.on('data',()=>{});
    p.on('error',()=>{clearTimeout(timer);reject(new Error('COMMAND'));});p.on('close',code=>{clearTimeout(timer);code===0?resolve(Buffer.concat(out).toString()):reject(new Error('COMMAND'));});p.stdin.end(input);
  });
}
function protectedFile(file,uid=0){const s=fs.lstatSync(file);requireFact(s.isFile()&&!s.isSymbolicLink()&&s.uid===uid&&(s.mode&0o077)===0,'PERMISSIONS');return s;}
function privateDir(dir,uid=0){const s=fs.lstatSync(dir);requireFact(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===uid&&(s.mode&0o077)===0,'PERMISSIONS');}
function readContract(){requireFact(process.platform==='linux'&&process.getuid()===0,'HOLD');privateDir(ROOT);protectedFile(`${ROOT}/runtime.json`);return validateContract(JSON.parse(fs.readFileSync(`${ROOT}/runtime.json`)));}
function actualCgroup(dir){const cpu=fs.readFileSync(`${dir}/cpu.max`,'utf8').trim().split(/\s+/);const memory=Number(fs.readFileSync(`${dir}/memory.max`,'utf8').trim());requireFact(fs.readFileSync(`${dir}/memory.swap.max`,'utf8').trim()==='0','SWAP');return {cpu:Number(cpu[0])/Number(cpu[1]),memory};}
function ownAux(c){const rel=fs.readFileSync('/proc/self/cgroup','utf8').trim().split('\n').find(x=>x.startsWith('0::'))?.slice(3);requireFact(rel&&path.resolve('/sys/fs/cgroup'+rel)===c.auxiliary.cgroup,'AUX_CGROUP');const row=actualCgroup(c.auxiliary.cgroup);requireFact(row.cpu<=c.auxiliary.cpu&&row.memory<=c.auxiliary.memory,'AUX_CGROUP');return row;}
function compose(c,args,budget){return command('docker',['compose','--project-name',c.project,'--file',`${ROOT}/compose.yaml`,...args],{timeout:budget.remaining(10000)});}
async function inspect(id){return JSON.parse(await command('docker',['inspect',id]))[0];}
async function ownContainers(c){const ids=(await command('docker',['ps','-aq','--filter',`label=com.docker.compose.project=${c.project}`])).trim().split(/\s+/).filter(Boolean);const rows=[];for(const id of ids){const i=await inspect(id);const service=i.Config.Labels['com.docker.compose.service'];assertOwned(i,c,service);rows.push(i);}requireFact(new Set(rows.map(x=>x.Config.Labels['com.docker.compose.service'])).size===rows.length,'UNKNOWN');return rows;}
async function baseline(c){
  requireFact(os.freemem()>=c.thresholds.minFreeMemory&&os.loadavg()[0]<=c.thresholds.maxLoad,'BASELINE');
  const disk=fs.statfsSync(ROOT);requireFact(disk.bavail*disk.bsize>=c.thresholds.minFreeDisk,'BASELINE');
  for(const b of c.baseline){const i=await inspect(b.id);requireFact(i.Image===b.image&&i.State.Status===b.status&&JSON.stringify(i.Mounts)===JSON.stringify(b.mounts),'BASELINE');
    requireFact(Number.isSafeInteger(b.memoryUsageBytes)&&b.memoryUsageBytes>=0,'BASELINE');
    const rel=fs.readFileSync(`/proc/${i.State.Pid}/cgroup`,'utf8').split('\n').find(x=>x.startsWith('0::'))?.slice(3).trim();requireFact(rel,'BASELINE');
    const dir='/sys/fs/cgroup'+rel;const memory=Number(fs.readFileSync(`${dir}/memory.current`,'utf8'));requireFact(memory-b.memoryUsageBytes<=c.thresholds.maxOldMemoryGrowth,'BASELINE');
    const stats=await command('docker',['stats','--no-stream','--format','{{.CPUPerc}}',b.id]);const cpu=Number(stats.trim().replace('%',''));requireFact(Number.isFinite(cpu)&&cpu<=c.thresholds.maxOldCpuPercent,'BASELINE');
  }
}
async function cgroups(c,containers){
  const rows=[ownAux(c)];
  for(const i of containers){assertOwned(i,c,i.Config.Labels['com.docker.compose.service']);requireFact(i.State.Running&&i.State.Pid>0&&!i.State.OOMKilled,'RESOURCES');
    const rel=fs.readFileSync(`/proc/${i.State.Pid}/cgroup`,'utf8').split('\n').find(x=>x.startsWith('0::'))?.slice(3);requireFact(rel,'RESOURCES');rows.push(actualCgroup('/sys/fs/cgroup'+rel.trim()));
    const status=fs.readFileSync(`/proc/${i.State.Pid}/status`,'utf8');const parent=Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);requireFact(parent>1,'SHIM');
    const args=fs.readFileSync(`/proc/${parent}/cmdline`,'utf8').split('\0');requireFact(path.basename(args[0])==='containerd-shim-runc-v2'&&args[args.indexOf('-id')+1]===i.Id,'SHIM');
    const shimRel=fs.readFileSync(`/proc/${parent}/cgroup`,'utf8').split('\n').find(x=>x.startsWith('0::'))?.slice(3).trim();requireFact('/sys/fs/cgroup'+shimRel===c.auxiliary.cgroup,'SHIM_BUDGET');
  }
  assertResources(rows);return rows;
}
async function preflight(c,{port=true}={}){
  for(const name of SOURCE_FILES){const file=`${ROOT}/${name}`;requireFact(!fs.lstatSync(file).isSymbolicLink()&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===c.sourceHashes[name],'SOURCE');}
  requireFact(!fs.readFileSync('/proc/sys/kernel/core_pattern','utf8').trim().startsWith('|'),'CORE_HANDLER');
  requireFact(fs.readFileSync('/proc/self/limits','utf8').split('\n').some(x=>/^Max core file size\s+0\s+0\s+bytes$/.test(x.trim())),'CORE');
  requireFact(fs.readFileSync('/sys/class/dmi/id/product_uuid','utf8').trim()===c.machineUuid&&typeof c.machineUuid==='string','HOST');
  ownAux(c);await baseline(c);
  privateDir(`${ROOT}/secrets`);privateDir(`${ROOT}/data`,991);privateDir(`${ROOT}/events`);
  protectedFile(`${ROOT}/secrets/tls.key`);protectedFile(`${ROOT}/secrets/tls.crt`);
  const cert=fs.readFileSync(`${ROOT}/secrets/tls.crt`);requireFact(crypto.createHash('sha256').update(cert).digest('hex')===c.certificateSha256,'TLS');
  const x=new crypto.X509Certificate(cert);requireFact(x.checkHost(c.domain)&&Date.parse(x.validTo)>Date.now(),'TLS');
  const info=JSON.parse(await command('docker',['info','--format','{{json .}}']));requireFact(info.OSType==='linux'&&info.Architecture==='x86_64'&&info.CgroupVersion==='2','PLATFORM');
  for(const p of Object.values(PINS)){const i=JSON.parse(await command('docker',['image','inspect',p.image]))[0];requireFact(i.Os==='linux'&&i.Architecture==='amd64'&&i.RepoDigests.includes(p.image),'IMAGE');}
  if(port)await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(new Error('BUSY')));s.listen(c.port,'127.0.0.1',()=>s.close(resolve));});
}
function yamlString(x){return JSON.stringify(x);}
function render(c,text,values){return text.replace(/\{\{([A-Z_]+)\}\}/g,(_,key)=>{requireFact(Object.hasOwn(values,key),'TEMPLATE');return values[key];});}
async function configure(c){
  await preflight(c);requireFact((await ownContainers(c)).length===0,'BUSY');
  const fresh=()=>crypto.randomBytes(32).toString('hex');
  const secrets={AS_TOKEN:fresh(),HS_TOKEN:fresh(),REGISTRATION_SECRET:fresh(),MACAROON_SECRET:fresh(),FORM_SECRET:fresh(),LIVEKIT_KEY:fresh(),LIVEKIT_SECRET:fresh()};
  const values={...Object.fromEntries(Object.entries(secrets).map(([k,v])=>[k,yamlString(v)])),DOMAIN:yamlString(c.domain),DOMAIN_RAW:c.domain,DOMAIN_REGEX:c.domain.replaceAll('.','\\.'),PORT:String(c.port),RUN_ID:c.runId,ROOT};
  const targets=[['homeserver.yaml.example','secrets/homeserver.yaml',991],['appservice-registration.yaml.example','secrets/appservice.yaml',991],['livekit.yaml.example','secrets/livekit.yaml',0],['Caddyfile','secrets/Caddyfile',0]];
  for(const [,target] of targets)requireFact(!fs.existsSync(`${ROOT}/${target}`),'BUSY');
  for(const [source,target,uid] of targets){const out=render(c,fs.readFileSync(`${ROOT}/${source}`,'utf8'),values);fs.writeFileSync(`${ROOT}/${target}`,out,{flag:'wx',mode:0o400});fs.chownSync(`${ROOT}/${target}`,uid,uid);}
  fs.writeFileSync(`${ROOT}/secrets/livekit.key`,secrets.LIVEKIT_KEY,{flag:'wx',mode:0o400});fs.writeFileSync(`${ROOT}/secrets/livekit.secret`,secrets.LIVEKIT_SECRET,{flag:'wx',mode:0o400});
  const env=`RTC_DOMAIN=${c.domain}\nRTC_PORT=${c.port}\nRTC_RUN_ID=${c.runId}\n`;fs.writeFileSync(`${ROOT}/.env`,env,{flag:'wx',mode:0o400});
  await compose(c,['config','--quiet'],new Budget(10000));
}
function validateGenerated(c){
  const files=[['homeserver.yaml',991],['appservice.yaml',991],['livekit.yaml',0],['Caddyfile',0],['livekit.key',0],['livekit.secret',0]];
  for(const [name,uid] of files)protectedFile(`${ROOT}/secrets/${name}`,uid);
  protectedFile(`${ROOT}/.env`);requireFact(fs.readFileSync(`${ROOT}/.env`,'utf8')===`RTC_DOMAIN=${c.domain}\nRTC_PORT=${c.port}\nRTC_RUN_ID=${c.runId}\n`,'CONFIG');
  const homeserver=fs.readFileSync(`${ROOT}/secrets/homeserver.yaml`,'utf8'),registration=fs.readFileSync(`${ROOT}/secrets/appservice.yaml`,'utf8');
  const secrets={};for(const [key,yaml,text] of [['AS_TOKEN','as_token',registration],['HS_TOKEN','hs_token',registration],['REGISTRATION_SECRET','registration_shared_secret',homeserver],['MACAROON_SECRET','macaroon_secret_key',homeserver],['FORM_SECRET','form_secret',homeserver]]){
    const value=JSON.parse(text.match(new RegExp('^'+yaml+': (.+)$','m'))?.[1]??'null');requireFact(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'CONFIG');secrets[key]=yamlString(value);
  }
  for(const [key,name] of [['LIVEKIT_KEY','livekit.key'],['LIVEKIT_SECRET','livekit.secret']]){const value=fs.readFileSync(`${ROOT}/secrets/${name}`,'utf8');requireFact(/^[a-f0-9]{64}$/.test(value),'CONFIG');secrets[key]=yamlString(value);}
  const values={...secrets,DOMAIN:yamlString(c.domain),DOMAIN_RAW:c.domain,DOMAIN_REGEX:c.domain.replaceAll('.','\\.'),PORT:String(c.port),RUN_ID:c.runId,ROOT};
  for(const [template,target] of [['homeserver.yaml.example','homeserver.yaml'],['appservice-registration.yaml.example','appservice.yaml'],['livekit.yaml.example','livekit.yaml'],['Caddyfile','Caddyfile']])requireFact(render(c,fs.readFileSync(`${ROOT}/${template}`,'utf8'),values)===fs.readFileSync(`${ROOT}/secrets/${target}`,'utf8'),'CONFIG');
}

export function roomAlias(room){return crypto.createHash('sha256').update(JSON.stringify([room,'m.call#ROOM'])).digest('base64').replace(/=+$/,'');}
function jwt(claims,secret){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const p=Buffer.from(JSON.stringify(claims)).toString('base64url');return `${h}.${p}.${crypto.createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`;}
function decodeTicket(token,secret){const parts=token.split('.');requireFact(parts.length===3,'JWT');const signature=crypto.createHmac('sha256',secret).update(parts.slice(0,2).join('.')).digest();const received=Buffer.from(parts[2],'base64url');requireFact(received.length===signature.length&&crypto.timingSafeEqual(signature,received)&&JSON.parse(Buffer.from(parts[0],'base64url')).alg==='HS256','JWT');return JSON.parse(Buffer.from(parts[1],'base64url'));}

// This helper runs inside the verified Synapse cgroup. It never prints requests,
// URLs, exception text, headers or response bodies. Control input is enum-only.
export const OPENID_HELPER=String.raw`
import http.server,json,sys,threading,socket,time
mode='real'; user=''; lock=threading.Lock()
listenPort=int(sys.argv[1]) if len(sys.argv)>1 else 8009
realPort=int(sys.argv[2]) if len(sys.argv)>2 else 8008
testPorts=0 if len(sys.argv)>1 else None
def emit(event,**counts):
 with lock:
  print(json.dumps({'event':event,**counts}),flush=True)
class SilentHandler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def log_request(self,*args): pass
 def log_error(self,*args): pass
class Handler(SilentHandler):
 def do_GET(self):
  emit('open')
  try:
   current=mode
   if current=='fixture':
    payload=json.dumps({'sub':user}).encode(); self.send_response(200); self.end_headers(); self.wfile.write(payload)
   elif current.startswith('redirect'):
    status=int(current[8:]); self.send_response(status); self.send_header('Location','http://127.0.0.1:8010/destination'); self.send_header('Refresh','0; http://127.0.0.1:8010/destination'); self.end_headers(); self.wfile.write(b'fixture')
   else:
    conn=None; deadline=time.monotonic()+6; status=504; payload=b''
    try:
     if len(self.path)>2048 or '\r' in self.path or '\n' in self.path: raise ValueError()
     conn=socket.create_connection(('127.0.0.1',timeoutServer.server_address[1] if current=='timeout' else realPort),timeout=max(.001,deadline-time.monotonic()))
     conn.settimeout(max(.001,deadline-time.monotonic()))
     conn.sendall(('GET '+self.path+' HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n').encode('ascii'))
     chunks=[]; size=0
     while True:
      remaining=deadline-time.monotonic()
      if remaining<=0: raise TimeoutError()
      conn.settimeout(remaining)
      chunk=conn.recv(1024)
      if not chunk: break
      size+=len(chunk)
      if size>4096: raise ValueError()
      chunks.append(chunk)
     head,raw=b''.join(chunks).split(b'\r\n\r\n',1)
     statusLine=head.split(b'\r\n',1)[0].split(b' ')
     if statusLine[0] not in [b'HTTP/1.0',b'HTTP/1.1']: raise ValueError()
     upstreamStatus=int(statusLine[1])
     if b'transfer-encoding:' in head.lower(): raise ValueError()
     if 300<=upstreamStatus<400: status=502
     elif upstreamStatus==200:
      parsed=json.loads(raw); sub=parsed.get('sub')
      if not isinstance(sub,str) or len(sub)>512 or not sub.startswith('@'): raise ValueError()
      status=200; payload=json.dumps({'sub':sub}).encode()
     elif upstreamStatus in [401,403]: status=upstreamStatus; payload=b'{"errcode":"M_UNKNOWN_TOKEN"}'
     else: status=502
    except Exception: status=504; payload=b''
    finally:
     if conn:
      try: conn.shutdown(socket.SHUT_RDWR)
      except OSError: pass
      conn.close()
    self.send_response(status); self.send_header('Content-Type','application/json'); self.end_headers(); self.wfile.write(payload)
  except Exception: emit('fault')
  finally: emit('close'); self.close_connection=True
class Destination(SilentHandler):
 def do_GET(self): emit('destination'); self.send_response(200); self.end_headers()
class Timeout(SilentHandler):
 def do_GET(self):
  emit('upstreamOpen'); self.connection.settimeout(.1); end=time.monotonic()+9
  while time.monotonic()<end:
   try:
    if self.connection.recv(1,socket.MSG_PEEK)==b'': emit('upstreamClosed'); return
   except socket.timeout: pass
  emit('fault')
def control():
 global mode,user
 for line in sys.stdin:
  try:
   value=json.loads(line); candidate=value.get('mode','')
   if candidate in ['real','fixture','timeout'] or candidate in ['redirect'+str(x) for x in range(300,400)]:
    mode=candidate
    if candidate=='fixture': user=value['user']
    emit('ack')
  except Exception: emit('fault')
 threading.Thread(target=lambda:None).start()
class QuietServer(http.server.ThreadingHTTPServer):
 def handle_error(self,request,client_address): emit('fault')
threading.Thread(target=control,daemon=True).start()
destinationServer=QuietServer(('127.0.0.1',testPorts if testPorts is not None else 8010),Destination)
timeoutServer=QuietServer(('127.0.0.1',testPorts if testPorts is not None else 8011),Timeout)
threading.Thread(target=destinationServer.serve_forever,daemon=True).start()
threading.Thread(target=timeoutServer.serve_forever,daemon=True).start()
server=QuietServer(('127.0.0.1' if testPorts is not None else '0.0.0.0',listenPort),Handler)
emit('ready',port=server.server_address[1])
server.serve_forever()
`;
function lookupLoopback(host,options,callback){callback(null,options.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4);}
class Runtime {
  constructor(c){this.c=c;this.attaches=new Map();this.sockets=new Set();this.fixture={open:0,close:0,upstreamOpen:0,upstreamClosed:0,destination:0,ack:0,ready:0,fault:0};this.stopping=false;this.budget=new Budget(300000);this.events=new SafeEvents(event=>{
    fs.appendFileSync(`${ROOT}/events/${c.runId}.jsonl`,JSON.stringify({...event,time:new Date().toISOString()})+'\n',{mode:0o600,flag:'a'});
  });}
  async waitFor(predicate,budget){while(!predicate()){await new Promise(r=>setTimeout(r,Math.min(25,budget.remaining())));}}
  async start(){
    const budget=new Budget(120000);await preflight(this.c);validateGenerated(this.c);await compose(this.c,['create','--pull','never'],budget);
    const containers=await ownContainers(this.c);requireFact(containers.length===4,'OWNERSHIP');
    for(const i of containers){requireFact(i.HostConfig.LogConfig.Type==='none'&&i.HostConfig.MemorySwap===i.HostConfig.Memory&&i.HostConfig.Memory>0&&i.HostConfig.NanoCpus>0&&i.HostConfig.NetworkMode!=='host'&&!i.HostConfig.Privileged&&i.HostConfig.Ulimits.some(x=>x.Name==='core'&&x.Hard===0&&x.Soft===0),'CONFIG');}
    for(const service of ['synapse','livekit','auth','caddy']){
      const i=containers.find(x=>x.Config.Labels['com.docker.compose.service']===service);assertOwned(i,this.c,service);
      const child=spawn('docker',['start','--attach',i.Id],{stdio:['ignore','pipe','pipe']});const state={child,ended:false,id:i.Id};this.attaches.set(service,state);
      child.stdout.on('data',b=>this.events.consume(service,b));child.stderr.on('data',b=>this.events.consume(service,b));child.on('error',()=>{state.ended=true;});child.on('close',()=>{state.ended=true;});
      while(!(await inspect(i.Id)).State.Running){requireFact(!state.ended,'START');await new Promise(r=>setTimeout(r,Math.min(25,budget.remaining())));}
      const actual=await inspect(i.Id);await cgroups(this.c,[actual]);this.events.event(service,'started');
      if(service==='synapse')await this.startHelper(i.Id,budget);
    }
    await cgroups(this.c,await ownContainers(this.c));await baseline(this.c);
    let ready=false;while(!ready){try{await this.api('/_matrix/client/versions',{},budget);ready=true;}catch{budget.remaining();await new Promise(r=>setTimeout(r,100));}}
    let auditing=false;this.monitor=setInterval(()=>{if(auditing||this.stopping)return;auditing=true;this.audit().catch(()=>this.stop().catch(()=>{})).finally(()=>{auditing=false;});},1000);
  }
  async startHelper(id,budget){
    this.helper=spawn('docker',['exec','-i',id,'python','-u','-c',OPENID_HELPER],{stdio:['pipe','pipe','pipe']});let carry='';
    this.helper.stdout.on('data',chunk=>{carry+=chunk.toString();requireFact(carry.length<65536,'HELPER');let index;while((index=carry.indexOf('\n'))>=0){const line=carry.slice(0,index);carry=carry.slice(index+1);try{const x=JSON.parse(line);if(Object.hasOwn(this.fixture,x.event))this.fixture[x.event]++;else this.fixture.fault++;}catch{this.fixture.fault++;}}});
    this.helper.stderr.on('data',b=>this.events.consume('synapse',b));this.helper.on('error',()=>{this.fixture.fault++;});this.helper.on('close',()=>{if(!this.stopping)this.fixture.fault++;});
    await this.waitFor(()=>this.fixture.ready===1,budget);
  }
  async mode(mode,user){requireFact(['real','fixture','timeout'].includes(mode)||/^redirect3\d\d$/.test(mode),'MODE');requireFact(!user||new RegExp(`^@rtc-[ab]:${this.c.domain.replaceAll('.','\\.')}$`).test(user),'MODE');const count=this.fixture.ack;this.helper.stdin.write(JSON.stringify({mode,...(user?{user}:{})})+'\n');await this.waitFor(()=>this.fixture.ack>count,new Budget(1000));}
  async audit(){this.budget.remaining();requireFact(this.fixture.fault===0,'HELPER');await baseline(this.c);await cgroups(this.c,await ownContainers(this.c));requireFact([...this.attaches.values()].every(x=>!x.ended),'ATTACH');}
  async api(route,{method='GET',body,token,expected=200}={},budget=new Budget(10000)){
    const r=await httpRequest(`https://${this.c.domain}:${this.c.port}${route}`,{method,body:body===undefined?undefined:JSON.stringify(body),token,lookup:lookupLoopback,timeout:budget.remaining(8000),headers:body===undefined?{}:{'Content-Type':'application/json'}});
    this.events.event('verifier','http',r.status,r.status===expected?'OK':'FAIL');requireFact(r.status===expected,'HTTP');let parsed;try{parsed=JSON.parse(r.body);}catch{throw new Error('BODY');}return parsed;
  }
  async auth(body,budget){const result=await transaction(()=>httpRequest(`https://${this.c.domain}:${this.c.port}/sfu/get`,{method:'POST',body:JSON.stringify(body),lookup:lookupLoopback,timeout:budget.remaining(10000),headers:{'Content-Type':'application/json'}}),()=>this.killAuth(),{budget,timeout:8000,limit:10000});requireFact(result.status==='OK','DEADLINE');return result.value;}
  async killAuth(){
    const state=this.attaches.get('auth');requireFact(state,'UNKNOWN');const i=await inspect(state.id);assertOwned(i,this.c,'auth');await command('docker',['kill','--signal','KILL',i.Id],{timeout:1000});
    const budget=new Budget(1500);let exit=false;while(true){exit=!(await inspect(i.Id)).State.Running;if(exit&&state.ended&&this.fixture.open===this.fixture.close&&this.fixture.upstreamOpen===this.fixture.upstreamClosed)break;await new Promise(r=>setTimeout(r,Math.min(10,budget.remaining())));}
    return {exit,attachEnd:state.ended,upstreamClosed:this.fixture.open===this.fixture.close&&this.fixture.upstreamOpen===this.fixture.upstreamClosed};
  }
  async stop(){
    if(this.stopping)return;this.stopping=true;clearInterval(this.monitor);const budget=new Budget(60000);let unknown=false;
    for(const service of [...SERVICES].reverse()){
      const state=this.attaches.get(service);if(!state)continue;
      try{const i=await inspect(state.id);assertOwned(i,this.c,service);if(i.State.Running)await command('docker',['stop','--time','3',i.Id],{timeout:budget.remaining(10000)});const end=await inspect(i.Id);requireFact(!end.State.Running,'STOP');await this.waitFor(()=>state.ended,budget);this.events.event(service,'stopped');}catch{unknown=true;}
    }
    await baseline(this.c);this.events.event('verifier','chunks',0,'OK',this.events.chunks);requireFact(!unknown,'UNKNOWN');
  }
}

// Complete one bounded RFC6455 upgrade. The client sends no offer, data channel,
// track or device request. LiveKit admin state proves acceptance independently.
export function signal(url,token,{lookup,timeout=8000}={}){
  const u=new URL(url);requireFact(u.protocol==='wss:'&&!u.search&&!u.username&&!u.password,'TLS');u.protocol='https:';u.pathname='/rtc';u.search='?protocol=16&auto_subscribe=0';
  return new Promise((resolve,reject)=>{
    const key=crypto.randomBytes(16).toString('base64');const req=https.request(u,{lookup,rejectUnauthorized:true,headers:{Authorization:`Bearer ${token}`,Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':key}});
    const timer=setTimeout(()=>{req.destroy();reject(new Error('DEADLINE'));},timeout);
    req.on('upgrade',(response,socket,head)=>{clearTimeout(timer);const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');if(response.statusCode!==101||response.headers['sec-websocket-accept']!==accept){socket.destroy();reject(new Error('SIGNAL'));return;}socket.on('error',()=>{});socket.on('data',()=>{});if(head.length>1048576){socket.destroy();reject(new Error('SIGNAL'));return;}resolve(socket);});
    req.on('response',()=>{clearTimeout(timer);req.destroy();reject(new Error('SIGNAL'));});req.on('error',()=>{clearTimeout(timer);reject(new Error('NETWORK'));});req.end();
  });
}

Runtime.prototype.register=async function(name,budget){
  const endpoint='/_synapse/admin/v1/register';const {nonce}=await this.api(endpoint,{},budget);const password=crypto.randomBytes(32).toString('hex');
  const config=fs.readFileSync(`${ROOT}/secrets/homeserver.yaml`,'utf8');const secret=JSON.parse(config.match(/^registration_shared_secret: (.+)$/m)[1]);
  const mac=crypto.createHmac('sha1',secret).update([nonce,name,password,'notadmin'].join('\0')).digest('hex');
  const result=await this.api(endpoint,{method:'POST',body:{nonce,username:name,password,admin:false,mac}},budget);
  requireFact(result.user_id===`@${name}:${this.c.domain}`&&typeof result.access_token==='string'&&typeof result.device_id==='string','IDENTITY');return result;
};
Runtime.prototype.admin=async function(method,body,budget){
  const key=fs.readFileSync(`${ROOT}/secrets/livekit.key`,'utf8'),secret=fs.readFileSync(`${ROOT}/secrets/livekit.secret`,'utf8');
  const token=jwt({iss:key,sub:'rtc-r0-verifier',nbf:Math.floor(Date.now()/1000)-1,exp:Math.floor(Date.now()/1000)+60,video:{roomAdmin:true,room:body.room}},secret);
  const r=await httpRequest(`https://${this.c.domain}:${this.c.port}/twirp/livekit.RoomService/${method}`,{method:'POST',body:JSON.stringify(body),token,lookup:lookupLoopback,timeout:budget.remaining(8000),headers:{'Content-Type':'application/json'}});
  const parsed=JSON.parse(r.body);if(method==='ListParticipants'&&r.status===404&&parsed.code==='not_found')return {participants:[]};requireFact(r.status===200,'ADMIN');return parsed;
};
Runtime.prototype.openid=async function(account,budget){
  const result=await this.api(`/_matrix/client/v3/user/${encodeURIComponent(account.user_id)}/openid/request_token`,{method:'POST',token:account.access_token,body:{}},budget);
  requireFact(result.matrix_server_name===this.c.domain&&typeof result.access_token==='string','OPENID');return result;
};
Runtime.prototype.denied=async function(body,budget){
  const before=await this.admin('ListParticipants',{room:roomAlias(body.room)},budget);
  const result=await this.auth(body,budget);requireFact([401,403].includes(result.status),'DENIAL');
  const parsed=JSON.parse(result.body);requireFact(!parsed.jwt&&typeof parsed.errcode==='string','DENIAL');
  const after=await this.admin('ListParticipants',{room:roomAlias(body.room)},budget);
  assertParticipants(after.participants??[],(before.participants??[]).map(x=>x.identity));this.events.event('auth','http',result.status,'M_FORBIDDEN');
};
Runtime.prototype.scan=async function(secrets){
  const file=`${ROOT}/events/${this.c.runId}.jsonl`;protectedFile(file);const content=fs.readFileSync(file,'utf8');
  for(const secret of secrets){const forms=[secret,encodeURIComponent(secret),JSON.stringify(secret).slice(1,-1),[...secret].map(x=>'\\u'+x.charCodeAt(0).toString(16).padStart(4,'0')).join('')];requireFact(forms.every(x=>!content.includes(x)),'LEAK');}
  requireFact(!fs.existsSync(`${ROOT}/data/homeserver.log`),'LOG_FILE');for(const i of await ownContainers(this.c))requireFact(i.HostConfig.LogConfig.Type==='none','LOG_DRIVER');
  this.events.event('verifier','scan',0,'OK',secrets.length);
};
Runtime.prototype.sentinels=async function(account,room,budget){
  const sentinel='incapable-'+crypto.randomBytes(24).toString('hex');const body={room,device_id:account.device_id,openid_token:{access_token:sentinel,token_type:'Bearer',expires_in:1,matrix_server_name:this.c.domain}};
  await this.mode('real');await this.denied(body,budget);await this.scan([sentinel]);
  await this.mode('fixture',account.user_id);const fixture=await this.auth(body,budget);requireFact(fixture.status===200,'FIXTURE');this.events.event('auth','gate',200,'OK',1);await this.scan([sentinel]);
  for(let status=300;status<400;status++){
    await this.mode(`redirect${status}`);const r=await httpRequest(`https://${this.c.domain}:${this.c.port}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(sentinel)}`,{lookup:lookupLoopback,timeout:budget.remaining(8000)});
    requireFact(r.status===502&&!r.headers.location&&!r.headers.refresh&&r.body.length===0&&this.fixture.destination===0,'REDIRECT');
  }
  for(const server of ['127.0.0.1:9','127.0.0.1:8080']){
    const r=await this.auth({...body,openid_token:{...body.openid_token,matrix_server_name:server}},budget);requireFact(r.status>=400&&r.status<600,'FAULT');await this.scan([sentinel]);
  }
  await this.mode('timeout');const started=performance.now();const open=this.fixture.upstreamOpen;
  const r=await transaction(()=>httpRequest(`https://${this.c.domain}:${this.c.port}/sfu/get`,{method:'POST',body:JSON.stringify(body),lookup:lookupLoopback,timeout:10000,headers:{'Content-Type':'application/json'}}),()=>this.killAuth(),{budget,timeout:8000,limit:10000});
  requireFact(r.status==='OK'&&r.value.status>=400&&r.value.status<600,'DEADLINE_PROOF');
  await this.waitFor(()=>this.fixture.upstreamOpen>open&&this.fixture.upstreamOpen===this.fixture.upstreamClosed&&this.fixture.open===this.fixture.close,new Budget(Math.max(1,10000-(performance.now()-started))));
  requireFact(performance.now()-started<10000,'DEADLINE_PROOF');
  await this.mode('real');await this.scan([sentinel]);this.events.event('verifier','gate',200,'OK',100);
};
Runtime.prototype.verify=async function(){
  const budget=new Budget(120000);await this.audit();const secrets=[];const sockets=[];
  try{
    const a=await this.register('rtc-a',budget),b=await this.register('rtc-b',budget),outsider=await this.register('rtc-outsider',budget);
    secrets.push(a.access_token,b.access_token,outsider.access_token);
    const room=(await this.api('/_matrix/client/v3/createRoom',{method:'POST',token:a.access_token,body:{preset:'private_chat',visibility:'private',creation_content:{'m.federate':false}}},budget)).room_id;
    const other=(await this.api('/_matrix/client/v3/createRoom',{method:'POST',token:outsider.access_token,body:{preset:'private_chat',visibility:'private',creation_content:{'m.federate':false}}},budget)).room_id;
    await this.sentinels(a,room,budget);
    const tokenA=await this.openid(a,budget),tokenB=await this.openid(b,budget),tokenOut=await this.openid(outsider,budget);secrets.push(tokenA.access_token,tokenB.access_token,tokenOut.access_token);
    const request=(account,openid,roomId=room)=>({room:roomId,device_id:account.device_id,openid_token:openid});
    await this.denied(request(outsider,tokenOut),budget);await this.denied(request(b,tokenB),budget);await this.denied(request(a,tokenA,other),budget);
    const encoded=encodeURIComponent(room);await this.api(`/_matrix/client/v3/rooms/${encoded}/invite`,{method:'POST',body:{user_id:b.user_id},token:a.access_token},budget);await this.denied(request(b,tokenB),budget);
    await this.api(`/_matrix/client/v3/join/${encoded}`,{method:'POST',body:{},token:b.access_token},budget);
    for(const account of [a,b]){
      const member=await this.api(`/_matrix/client/v3/rooms/${encoded}/state/m.room.member/${encodeURIComponent(account.user_id)}`,{token:a.access_token},budget);requireFact(member.membership==='join','MEMBERSHIP');
    }
    const key=fs.readFileSync(`${ROOT}/secrets/livekit.key`,'utf8'),secret=fs.readFileSync(`${ROOT}/secrets/livekit.secret`,'utf8');const expected=[];
    for(const [account,openid] of [[a,tokenA],[b,tokenB]]){
      const r=await this.auth(request(account,openid),budget);requireFact(r.status===200,'SFU');const ticket=JSON.parse(r.body);requireFact(ticket.url===`wss://${this.c.domain}:${this.c.port}`,'SFU_URL');secrets.push(ticket.jwt);
      const subject=`${account.user_id}:${account.device_id}`;assertTicket(decodeTicket(ticket.jwt,secret),{subject,room:roomAlias(room),key});expected.push(subject);
      const socket=await signal(ticket.url,ticket.jwt,{lookup:lookupLoopback,timeout:budget.remaining(8000)});sockets.push(socket);
      const participants=await this.admin('ListParticipants',{room:roomAlias(room)},budget);assertParticipants(participants.participants??[],expected);
    }
    const wrong=await httpRequest(`https://${this.c.domain}:${this.c.port}/get_token`,{method:'POST',lookup:lookupLoopback,timeout:budget.remaining(8000),body:JSON.stringify({room_id:room,slot_id:'m.call#ROOM',openid_token:tokenA,member:{id:'wrong-subject',claimed_user_id:outsider.user_id,claimed_device_id:a.device_id}}),headers:{'Content-Type':'application/json'}});
    requireFact([401,403].includes(wrong.status)&&!JSON.parse(wrong.body).jwt,'WRONG_SUBJECT');
    await this.api(`/_matrix/client/v3/rooms/${encoded}/kick`,{method:'POST',body:{user_id:b.user_id},token:a.access_token},budget);const fresh=await this.openid(b,budget);secrets.push(fresh.access_token);await this.denied(request(b,fresh),budget);
    // Existing participants and old JWT remain separate upstream behavior. Remove
    // both own participants explicitly; do not claim kick revokes established RTC.
    for(const identity of expected)await this.admin('RemoveParticipant',{room:roomAlias(room),identity},budget);
    assertParticipants((await this.admin('ListParticipants',{room:roomAlias(room)},budget)).participants??[],[]);
    await this.scan(secrets);await this.audit();this.events.event('verifier','participants',200,'OK',2);this.events.event('verifier','gate',200,'OK',0);
  }finally{for(const socket of sockets)socket.destroy();}
};

async function ipc(c,action,timeout=10000){
  requireFact(['status','verify','stop'].includes(action),'IPC');const sock=`${ROOT}/supervisor.sock`;protectedSocket(sock);
  return new Promise((resolve,reject)=>{const client=net.createConnection(sock);let carry='';const timer=setTimeout(()=>{client.destroy();reject(new Error('DEADLINE'));},timeout);client.on('connect',()=>client.end(JSON.stringify({action})+'\n'));client.on('data',b=>{carry+=b; if(carry.length>256)client.destroy();});client.on('end',()=>{clearTimeout(timer);try{const r=JSON.parse(carry);requireFact(['OK','FAIL','BUSY'].includes(r.status),'IPC');resolve(r);}catch{reject(new Error('IPC'));}});client.on('error',()=>{clearTimeout(timer);reject(new Error('IPC'));});});
}
function protectedSocket(sock){const s=fs.lstatSync(sock);requireFact(s.isSocket()&&s.uid===0&&(s.mode&0o077)===0,'IPC');}
async function supervise(c){
  requireFact(!fs.existsSync(`${ROOT}/supervisor.sock`),'BUSY');const runtime=new Runtime(c);let ready=false,busy=true,stopped=false;
  const server=net.createServer({allowHalfOpen:true},client=>{let carry='';client.setTimeout(1000,()=>client.destroy());client.on('data',b=>{carry+=b;if(carry.length>128)client.destroy();});client.on('end',async()=>{
    client.setTimeout(0);let action;try{const value=JSON.parse(carry);requireFact(Object.keys(value).length===1,'IPC');action=value.action;}catch{client.end('{"status":"FAIL"}');return;}
    if(action==='status'){client.end(JSON.stringify({status:ready?'OK':'BUSY'}));return;}
    if(busy||!ready||!['verify','stop'].includes(action)){client.end('{"status":"BUSY"}');return;}
    busy=true;try{if(action==='verify')await runtime.verify();else{await runtime.stop();stopped=true;}client.end('{"status":"OK"}');}catch{await runtime.stop().catch(()=>{});stopped=true;client.end('{"status":"FAIL"}');}finally{busy=false;if(runtime.stopping||stopped){server.close();fs.unlinkSync(`${ROOT}/supervisor.sock`);}}
  });});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(`${ROOT}/supervisor.sock`,()=>{fs.chmodSync(`${ROOT}/supervisor.sock`,0o600);resolve();});});
  const timer=setTimeout(async()=>{await runtime.stop().catch(()=>{});server.close();if(fs.existsSync(`${ROOT}/supervisor.sock`))fs.unlinkSync(`${ROOT}/supervisor.sock`);},300000);timer.unref();
  try{await runtime.start();ready=true;busy=false;}catch{await runtime.stop().catch(()=>{});server.close();fs.unlinkSync(`${ROOT}/supervisor.sock`);throw new Error('START');}
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await runtime.stop().catch(()=>{});server.close();if(fs.existsSync(`${ROOT}/supervisor.sock`))fs.unlinkSync(`${ROOT}/supervisor.sock`);});
}
export async function main(action){
  requireFact(['preflight','config','up','verify','stop','__supervise'].includes(action),'COMMAND');const c=readContract();
  if(action==='preflight')await preflight(c);
  else if(action==='config')await configure(c);
  else if(action==='__supervise')await supervise(c);
  else if(action==='up'){
    await preflight(c);requireFact(!fs.existsSync(`${ROOT}/supervisor.sock`),'BUSY');const child=spawn(process.execPath,[fileURLToPath(import.meta.url),'__supervise'],{detached:true,stdio:'ignore'});child.unref();
    const budget=new Budget(120000);let ready=false;while(!ready){budget.remaining();if(fs.existsSync(`${ROOT}/supervisor.sock`)){const r=await ipc(c,'status');ready=r.status==='OK';}if(!ready)await new Promise(r=>setTimeout(r,100));}
  }else if(action==='verify'){const r=await ipc(c,'verify',120000);requireFact(r.status==='OK','VERIFY');}
  else {const r=await ipc(c,'stop',60000);requireFact(r.status==='OK','STOP');}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv[2]).then(()=>{if(process.argv[2]!=='__supervise')process.stdout.write('{"service":"verifier","event":"command","errcode":"OK"}\n');}).catch(()=>{process.stderr.write(JSON.stringify({service:'verifier',event:'command',errcode:['verify','stop','__supervise'].includes(process.argv[2])?'FAIL':'HOLD'})+'\n');process.exitCode=1;});
