import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT='/opt/babacom-matrix-rtc-e9', PROJECT='babacom-matrix-rtc-e9';
const SERVICES=['synapse','livekit','auth','caddy'];
const SOURCE_FILES=['compose.yaml','homeserver.yaml.example','appservice-registration.yaml.example','livekit.yaml.example','Caddyfile','proof.mjs','proof.test.mjs'];
export const PINS=Object.freeze({
  synapse:{image:'ghcr.io/element-hq/synapse@sha256:43fd704aedef503a6fba2e5696439ef7bac24479a3472e364561973f550e4aad',source:'63dc0cbfe514f60743212566374ffeb5e9e295c2'},
  auth:{image:'ghcr.io/element-hq/lk-jwt-service@sha256:2c985ab98de8da3b101c09fb597404dcb2723bb984b1ee20a430a8bb4f6a51a9',source:'0e176b1eca44e67b11484d0bdf56999807bf2b8e'},
  livekit:{image:'docker.io/livekit/livekit-server@sha256:f63579e294b6dbf38e0e6151a24a5b425e9293e75e6d41959f470c957248b8a7',source:'0b3fd288e3ef3263ec475ba0d78cf3ad77459981'},
  caddy:{image:'docker.io/library/caddy@sha256:173b26306d711395accaeba8b67afcaad2a085ccb1e6bf26010bfe8c095a5229',source:'72dd0fb067f6d7826c7f79907670ba4a713bfe37'},
});
function requireFact(ok,code='CONTRACT',reason){if(!ok)throw new Error(code,reason?{cause:new Error(reason)}:undefined);}
export class Budget {
  constructor(ms,clock=()=>Number(process.hrtime.bigint())/1e6){requireFact(Number.isFinite(ms)&&ms>0);this.clock=clock;this.end=clock()+ms;}
  static fromDeadline(end){const budget=new Budget(1);requireFact(Number.isFinite(end),'DEADLINE');budget.end=end;budget.remaining();return budget;}
  remaining(cap=Infinity){this.guard?.();const n=Math.min(this.end-this.clock(),cap);requireFact(n>0,'DEADLINE');return Math.ceil(n);}
  child(ms){this.remaining();const child=new Budget(ms,this.clock);child.end=Math.min(child.end,this.end);child.guard=this.guard;child.signal=this.signal;return child;}
  async waitFor(predicate){while(true){this.remaining();if(predicate())return;await new Promise(r=>setTimeout(r,this.remaining(25)));}}
}
export function serverName(c){return `${c.domain}:${c.port}`;}
export function validateContract(c,action){
  requireFact(c&&c.host==='lhins-af0ntal8'&&c.root===ROOT&&c.project===PROJECT);
  // This Boolean describes the operator's plan, never an observed runtime gate.
  requireFact(c.approved===true&&typeof c.logAdmission==='boolean'&&/^[a-f0-9]{32}$/.test(c.runId));
  requireFact(typeof c.domain==='string'&&/^(?=.{4,253}$)[a-z0-9]+(?:[-.][a-z0-9]+)*\.[a-z]{2,}$/.test(c.domain));
  requireFact(Number.isInteger(c.port)&&c.port>1024&&c.port<65536);
  requireFact(c.certificateSource==='operator-provisioned-public-chain'&&/^[a-f0-9]{64}$/.test(c.certificateSha256));
  requireFact(c.asHomeserver===serverName(c)&&JSON.stringify(c.fullAccessHomeservers)===JSON.stringify([serverName(c)]));
  requireFact(typeof c.machineUuid==='string'&&c.machineUuid.length>0&&c.machineUuid.length<=128);
  requireFact(c.platform==='linux/amd64'&&isDeepStrictEqual(c.source,PINS));
  requireFact(c.sourceHashes&&Object.keys(c.sourceHashes).length===7&&SOURCE_FILES.every(name=>/^[a-f0-9]{64}$/.test(c.sourceHashes[name])));
  requireFact(Array.isArray(c.accessors)&&c.accessors.length>0&&c.accessors.every(x=>x==='operator-loopback'));
  requireFact(c.auxiliary&&c.auxiliary.unit==='babacomrtc'+c.runId+'.slice'&&c.auxiliary.cgroup==='/sys/fs/cgroup/'+c.auxiliary.unit);
  requireFact(c.auxiliary.cpu>0&&c.auxiliary.cpu<=.2&&c.auxiliary.memory>0&&c.auxiliary.memory<=268435456);
  requireFact(c.thresholds&&['minFreeMemory','minFreeDisk','maxLoad','maxOldCpuPercent','maxOldMemoryGrowth'].every(k=>Number.isFinite(c.thresholds[k])&&c.thresholds[k]>0));
  requireFact(Array.isArray(c.baseline)&&c.baseline.length>0&&c.baseline.every(x=>/^[a-f0-9]{64}$/.test(x.id)&&typeof x.image==='string'&&x.status==='running'&&Array.isArray(x.mounts)));
  requireFact(Array.isArray(c.nativeBaseline)&&c.nativeBaseline.length===5&&new Set(c.nativeBaseline.map(row=>row?.unit)).size===5&&c.nativeBaseline.every(row=>row&&/^maowo-[\w.@-]+\.service$/.test(row.unit)&&Number.isSafeInteger(row.pid)&&row.pid>1&&/^[a-f0-9]{32}$/.test(row.invocationId)),'BASELINE');
  requireFact(/^[a-f0-9]{64}$/.test(c.nodeSha256),'NODE');
  const metadata=row=>row&&typeof row.path==='string'&&path.isAbsolute(row.path)&&!row.path.split('/').includes('..')&&Number.isInteger(row.uid)&&row.uid>=0&&Number.isInteger(row.gid)&&row.gid>=0&&Number.isInteger(row.mode)&&row.mode>=0&&row.mode<=0o777&&Array.isArray(row.accessors)&&row.accessors.length>0&&row.accessors.every(x=>typeof x==='string'&&/^[a-zA-Z0-9_-]+$/.test(x));
  requireFact(c.persistence&&typeof c.persistence.corePattern==='string'&&c.persistence.corePattern.length>0&&c.persistence.corePattern.length<4096&&Array.isArray(c.persistence.locations)&&c.persistence.locations.length>0&&c.persistence.locations.every(x=>metadata(x)&&['swap','core-directory','core-handler'].includes(x.kind)),'PERSISTENCE');
  requireFact(c.logging&&Array.isArray(c.logging.coverage)&&['connection','handshake','success','timeout','tls'].every(name=>c.logging.coverage.includes(name))&&c.logging.coverage.every(name=>['connection','handshake','redirect','success','timeout','tls'].includes(name))&&new Set(c.logging.coverage).size===c.logging.coverage.length&&Array.isArray(c.logging.bypasses)&&c.logging.bypasses.length>0&&c.logging.bypasses.every(x=>metadata(x)&&['socket','file','directory'].includes(x.kind)&&x.writesRaw===false),'LOG_ADMISSION');
  validateSharedRuntime(c,[c.auxiliary.cgroup]);
  return c;
}
const LOG_CHANNELS=['stdout','stderr','retained','syslog'],LOG_METRICS=['chars','bytes','chunks'];
const EVENTS=new Set(['started','stopped','http','chunks','unknown','fault','gate','participants','resources','baseline','baseline_actual','baseline_limit','readiness','cleanup_admission','cleanup_worker','cleanup_unit','cleanup_receipt','cleanup_sample','cleanup_inspect','cleanup_unpause','cleanup_stop','cleanup_stopped','cleanup_result','cleanup_baseline','cleanup_budget','cleanup_monitor','cleanup_sockets','cleanup_attaches','cleanup_scan','command','scan','openid_ttl','jwt_remaining','shared_cpu_milli','shared_memory_bytes','log_connection','log_success','log_tls','log_handshake','log_timeout',...LOG_CHANNELS.flatMap(channel=>LOG_METRICS.map(metric=>'log_overflow_'+channel+'_'+metric))]);
const BASELINE_ERRORS=new Set(['BASELINE_MEMORY','BASELINE_LOAD','BASELINE_DISK','BASELINE_NATIVE_ACTIVE','BASELINE_NATIVE_SUBSTATE','BASELINE_NATIVE_PID','BASELINE_NATIVE_INVOCATION','BASELINE_IMAGE','BASELINE_STATE','BASELINE_MOUNTS','BASELINE_COUNTER','BASELINE_CGROUP']);
const JWT_ERRORS=['JWT_FORMAT','JWT_HEADER','JWT_SIGNATURE','JWT_ISSUER','JWT_SUBJECT','JWT_ROOM','JWT_TIME','JWT_GRANTS'];
const ERRORS=new Set(['OK','M_FORBIDDEN','M_UNAUTHORIZED','M_UNKNOWN_TOKEN','FAIL','HOLD','UNKNOWN','DEADLINE','CONTRACT','BUSY','OLD_CPU','OLD_MEMORY','SHARED_CPU','SHARED_MEMORY','BASELINE','RESOURCES','ATTACH','LEAK','CONFIG','DNS','READINESS','SOURCE','NODE','TLS','NETWORK','CONNECTION','COMMAND','STATE','OWNERSHIP','SHIM','ADMIN','AUX_CGROUP','BODY','BODY_LIMIT','CANCELLED','DENIAL','HOST','HTTP','IDENTITY','IMAGE','INCAPABLE','JOIN','JWT','LOG_ADMISSION','LOG_DRIVER','LOG_FILE','LOGOUT','MEMBERSHIP','MOUNTS','OPENID','OUTPUT_LIMIT','PERMISSIONS','PERSISTENCE','PLATFORM','PORT','SFU','SFU_URL','SIGNAL','START','SWAP','TEMPLATE','TRACKS','TTL','WRONG_SUBJECT',...BASELINE_ERRORS,...JWT_ERRORS]);
function knownFailure(error){let known;for(let depth=0;depth<8&&error instanceof Error;depth++,error=error.cause)if(error.message!=='OK'&&ERRORS.has(error.message))known=error;return known;}
function requireBaseline(ok,reason,{index=1,actual,limit,code='BASELINE'}={}){if(!ok)throw new Error(code,{cause:Object.assign(new Error(reason),{index,actual,limit})});}
function normalizedLog(text){return text.replace(/%([a-f\d]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))).replace(/\\u([a-f\d]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16))).replace(/\\([\\/"bfnrt])/g,(_,value)=>({b:'\b',f:'\f',n:'\n',r:'\r',t:'\t'}[value]??value));}
export class SafeEvents {
  constructor(write){this.write=write;this.bytes=0;this.chunks=0;this.markers=new Set();this.tails=new Map();this.streamCounts=new Map();this.retained=new Map();this.observed=0;this.leak=false;this.unknownDiscarded=false;}
  watch(marker){requireFact(typeof marker==='string'&&marker.length>0&&marker.length<=8192&&this.markers.size<512,'HOLD');if(this.markers.has(marker))return;requireFact(!this.unknownDiscarded,'HOLD');this.markers.add(marker);for(const [key,text] of this.tails)if(text.includes(marker)||normalizedLog(text).includes(marker)){this.observed++;if(key!=='auth:stderr')this.leak=true;}}
  get bufferedBytes(){return [...this.tails.values()].reduce((sum,value)=>sum+Buffer.byteLength(value),0);}
  consume(service,chunk,stream='stderr',source){
    requireFact(source===undefined||service==='verifier'&&stream==='retained'&&this.retained.has(source),'HOLD');
    this.bytes+=chunk.length;this.chunks++;const name=SERVICES.includes(service)?service:'verifier',channel=LOG_CHANNELS.includes(stream)?stream:'retained',key=name+':'+channel+(source===undefined?'':':'+source);
    const decoded=chunk.toString('utf8'),text=(this.tails.get(key)??'')+decoded;
    const counts=this.streamCounts.get(key)??{chars:0,bytes:0,chunks:0,overflow:false};
    counts.chars+=decoded.length;counts.bytes+=chunk.length;counts.chunks++;this.streamCounts.set(key,counts);
    const normalized=normalizedLog(text);
    for(const marker of this.markers)if(text.includes(marker)||normalized.includes(marker)){this.observed++;if(name!=='auth'||channel!=='stderr')this.leak=true;}
    // Twenty live channels plus at most 128 retained sources; each holds an escaped 8 KiB marker.
    // A future issued token cannot be cleared against unknown bytes already dropped.
    if(text.length>49168&&(name!=='auth'||channel!=='stderr')){
      this.unknownDiscarded=true;
      // First-discard totals only; chars uses the tail's UTF-16 units. Never emit paths or raw output.
      if(!counts.overflow){counts.overflow=true;for(const metric of LOG_METRICS)this.event(name,'log_overflow_'+channel+'_'+metric,0,'HOLD',counts[metric]);}
    }
    this.tails.set(key,text.slice(-49168));
  }
  check(){requireFact(!this.leak,'LEAK');}
  inspectRetained(source,content,budget){
    budget.remaining();requireFact(typeof source==='string'&&source.length>0&&source.length<=4096&&Buffer.isBuffer(content)&&content.length<=4194304,'HOLD');
    const previous=this.retained.get(source);requireFact(previous||this.retained.size<128,'HOLD');
    const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
    // Verify the entire old prefix before excluding it; rewrites are scanned in full.
    const offset=previous&&content.length>=previous.size&&digest(content.subarray(0,previous.size))===previous.hash?previous.size:0;
    const hash=digest(content);budget.remaining();this.retained.set(source,{size:content.length,hash});
    if(content.length>offset)this.consume('verifier',content.subarray(offset),'retained',source);
    budget.remaining();
  }
  inspectFile(file,budget){
    budget.remaining();const before=fs.lstatSync(file);requireFact(before.isFile()&&!before.isSymbolicLink()&&before.size<=1048576,'HOLD');
    const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
    try{
      const opened=fs.fstatSync(fd);requireFact(opened.ino===before.ino&&opened.dev===before.dev,'HOLD');const buffer=Buffer.alloc(8192),chunks=[];let size,total=0;
      while((size=fs.readSync(fd,buffer,0,buffer.length,null))>0){budget.remaining();total+=size;const chunk=buffer.subarray(0,size);requireFact(total<=1048576&&!chunk.includes(0),'HOLD');chunks.push(Buffer.from(chunk));}
      const after=fs.fstatSync(fd),name=fs.lstatSync(file);requireFact(after.size===before.size&&after.mtimeMs===before.mtimeMs&&name.ino===opened.ino&&name.dev===opened.dev&&!name.isSymbolicLink(),'HOLD');budget.remaining();
      this.inspectRetained(file,Buffer.concat(chunks,total),budget);
    }finally{fs.closeSync(fd);}
  }
  event(service,event,status=0,errcode='OK',count=1){
    const detail=errcode instanceof Error?knownFailure(errcode):undefined;
    if(errcode instanceof Error)errcode=detail?.message??'UNKNOWN';
    if(BASELINE_ERRORS.has(errcode)&&Number.isSafeInteger(detail?.index)&&detail.index>0)count=detail.index;
    if(event==='chunks'&&this.chunks>1)return;
    this.write({service:SERVICES.includes(service)?service:'verifier',event:EVENTS.has(event)?event:'unknown',status:Number.isInteger(status)&&status>=0&&status<600?status:0,errcode:ERRORS.has(errcode)?errcode:'UNKNOWN',count:Number.isSafeInteger(count)&&count>=0?count:0});
    if(BASELINE_ERRORS.has(errcode))for(const key of ['actual','limit'])if(Number.isSafeInteger(detail?.[key])&&detail[key]>=0)this.event(service,'baseline_'+key,0,errcode,detail[key]);
  }
}
export function recordTtl(events,event,seconds){requireFact(['openid_ttl','jwt_remaining'].includes(event)&&Number.isSafeInteger(seconds)&&seconds>0,'TTL');events.event('verifier',event,200,'OK',seconds);}
export function assertOwned(i,c,service){
  const l=i?.Config?.Labels;
  requireFact(/^[a-f0-9]{64}$/.test(i?.Id)&&SERVICES.includes(service)&&l?.['rtc.run']===c.runId&&l?.['rtc.host']===c.host&&l?.['com.docker.compose.project']===c.project&&l?.['com.docker.compose.service']===service&&i.Config.Image===PINS[service].image,'UNKNOWN');
}
export function assertResources(rows){
  requireFact(Array.isArray(rows)&&rows.length>0,'RESOURCES');
  requireFact(rows.every(x=>Number.isFinite(x.cpu)&&x.cpu>0&&Number.isSafeInteger(x.memory)&&x.memory>0),'RESOURCES');
  requireFact(rows.reduce((n,x)=>n+x.cpu,0)<=1.000000001&&rows.reduce((n,x)=>n+x.memory,0)<=1610612736,'RESOURCES');
}
export function assertContainerConfiguration(i,c,service){
  assertOwned(i,c,service);const h=i.HostConfig;
  requireFact(isDeepStrictEqual(h?.Annotations,{'org.systemd.property.MemorySwapMax':'uint64 0'}),'SWAP');
  requireFact(h?.LogConfig?.Type==='none'&&i.LogPath===''&&h.ReadonlyRootfs===true&&h.Privileged===false&&(service==='caddy'?[c.project+'_isolated',c.project+'_ingress'].includes(h.NetworkMode):h.NetworkMode===c.project+'_isolated')&&h.CapDrop?.includes('ALL'),'CONFIG');
  const added=h.CapAdd??[],security=h.SecurityOpt;
  requireFact(Array.isArray(added)&&(service==='caddy'?added.length===1&&['NET_BIND_SERVICE','CAP_NET_BIND_SERVICE'].includes(added[0]):added.length===0),'CONFIG');
  requireFact(Array.isArray(security)&&security.length===1&&['no-new-privileges','no-new-privileges:true','no-new-privileges=true'].includes(security[0]),'CONFIG');
  const ports=h.PortBindings??{},expected=service==='caddy'?{[c.port+'/tcp']:[{HostIp:'127.0.0.1',HostPort:String(c.port)}]}:{};
  requireFact(JSON.stringify(ports)===JSON.stringify(expected),'PORT');
  const names=service==='caddy'?['ingress','isolated']:['isolated'];
  requireFact(isDeepStrictEqual(Object.keys(i.NetworkSettings?.Networks??{}).sort(),names.map(name=>c.project+'_'+name).sort()),'CONFIG');
  if(i.State.Running){
    const published=Object.fromEntries(Object.entries(i.NetworkSettings?.Ports??{}).filter(([,bindings])=>bindings!==null));
    requireFact(isDeepStrictEqual(published,expected),'PORT');
  }
  const targets={synapse:['data','homeserver.yaml','appservice.yaml','log.config'],livekit:['livekit.yaml'],auth:['appservice.yaml','livekit.key','livekit.secret'],caddy:['Caddyfile','tls.crt','tls.key']}[service];
  requireFact(Array.isArray(i.Mounts)&&i.Mounts.filter(x=>x.Type==='bind').length===targets.length&&i.Mounts.every(x=>x.Type==='bind'||x.Type==='tmpfs'&&['/tmp',...(service==='caddy'?['/data','/config']:[])].includes(x.Destination)),'MOUNTS');
  for(const name of targets){const data=name==='data',source=c.root+(data?'/data':'/secrets/'+name),destination=data?'/data':'/run/secrets/'+name;requireFact(i.Mounts.some(x=>x.Type==='bind'&&x.Source===source&&x.Destination===destination&&x.RW===data),'MOUNTS');}
}
export function assertNetworkTopology(c,containers,networks){
  requireFact(containers.length===4&&networks.length===2,'CONFIG');
  for(const name of ['isolated','ingress']){
    const n=networks.find(row=>row.Name===c.project+'_'+name),members=containers.filter(i=>name==='isolated'||i.Config.Labels['com.docker.compose.service']==='caddy');
    requireFact(n&&n.Driver==='bridge'&&n.Scope==='local'&&n.Internal===(name==='isolated')&&n.EnableIPv6===false&&n.Labels?.['com.docker.compose.project']===c.project&&n.Labels?.['com.docker.compose.network']===name&&n.Labels?.['rtc.host']===c.host&&n.Labels?.['rtc.run']===c.runId,'CONFIG');
    requireFact(isDeepStrictEqual(Object.keys(n.Options??{}).sort(),name==='ingress'?['com.docker.network.bridge.host_binding_ipv4']:[])&&(name!=='ingress'||n.Options['com.docker.network.bridge.host_binding_ipv4']==='127.0.0.1'),'CONFIG');
    requireFact(isDeepStrictEqual(Object.keys(n.Containers??{}).sort(),members.map(i=>i.Id).sort())&&members.every(i=>i.NetworkSettings?.Networks?.[n.Name]?.NetworkID===n.Id),'CONFIG');
  }
}
export function assertPinnedImage(image,service){
  const pin=PINS[service]?.image,alias=pin?.startsWith('docker.io/')?pin.slice('docker.io/'.length).replace(/^library\//,''):pin;
  requireFact(pin&&image?.Os==='linux'&&image?.Architecture==='amd64'&&Array.isArray(image.RepoDigests)&&image.RepoDigests.some(digest=>digest===pin||digest===alias),'IMAGE');
}
export function httpRequest(url,{method='GET',body,token,timeout=8000,allowHttpFixture=false,lookup,headers={},signal,servername,expectedHostname}={}){
  const u=new URL(url);requireFact((u.protocol==='https:'||(allowHttpFixture&&u.protocol==='http:'&&u.hostname==='127.0.0.1'))&&!u.username&&!u.password,'TLS');
  requireFact(timeout>0&&timeout<=10000,'DEADLINE');
  requireFact(expectedHostname===undefined||typeof expectedHostname==='string'&&expectedHostname.length>0,'TLS');
  return new Promise((resolve,reject)=>{
    let size=0;const chunks=[];
    // A stricter probe needs a fresh TLS handshake, never a previously checked pooled socket.
    const req=(u.protocol==='https:'?https:http).request(u,{method,lookup,signal,servername,...(expectedHostname===undefined?{}:{agent:false}),rejectUnauthorized:true,checkServerIdentity:(_hostname,certificate)=>tls.checkServerIdentity(u.hostname,certificate)||(expectedHostname===undefined?undefined:tls.checkServerIdentity(expectedHostname,certificate)),headers:{...headers,...(token?{Authorization:`Bearer ${token}`}:{})}},res=>{
      res.on('data',b=>{size+=b.length;if(size>1048576){req.destroy();reject(new Error('BODY_LIMIT'));}else chunks.push(b);});
      res.on('end',()=>{clearTimeout(timer);resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)});});
      res.on('error',()=>{clearTimeout(timer);reject(new Error('NETWORK'));});
    });
    const timer=setTimeout(()=>{req.destroy();reject(new Error('DEADLINE'));},timeout);
    req.on('error',error=>{clearTimeout(timer);const code=error.code;reject(new Error(code==='ECONNREFUSED'?'CONNECTION':['ERR_TLS_CERT_ALTNAME_INVALID','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','CERT_HAS_EXPIRED','CERT_NOT_YET_VALID'].includes(code)?'TLS':'NETWORK'));});
    req.end(body);
  });
}
export function assertTicket(claims,e){
  requireFact(claims&&typeof claims==='object'&&!Array.isArray(claims),'JWT_FORMAT');
  requireFact(claims.iss===e.key,'JWT_ISSUER');requireFact(claims.sub===e.subject,'JWT_SUBJECT');
  const now=Date.now()/1000;requireFact(Number.isFinite(claims.exp)&&claims.exp>now&&claims.exp<=now+3610,'JWT_TIME');
  const v=claims.video;requireFact(v&&typeof v==='object'&&!Array.isArray(v),'JWT_GRANTS');requireFact(v.room===e.room,'JWT_ROOM');
  requireFact(v.roomJoin===true&&v.canPublish===true&&v.canSubscribe===true,'JWT_GRANTS');
  requireFact(Object.keys(v).every(k=>['room','roomJoin','canPublish','canSubscribe','canPublishData','canUpdateOwnMetadata','roomCreate','hidden','roomAdmin','roomList','roomRecord','destinationRoom','canPublishSources','ingressAdmin','recorder'].includes(k)),'JWT_GRANTS');
  // The pinned Rust serializer emits these defaults even though they add no authority.
  requireFact((v.destinationRoom===undefined||v.destinationRoom==='')&&(v.canPublishSources===undefined||Array.isArray(v.canPublishSources)&&v.canPublishSources.length===0)&&['ingressAdmin','recorder'].every(k=>v[k]===undefined||v[k]===false),'JWT_GRANTS');
  requireFact(['roomAdmin','roomCreate','roomList','roomRecord','hidden'].every(k=>v[k]!==true),'JWT_GRANTS');
  requireFact(['canPublishData','canUpdateOwnMetadata'].every(k=>v[k]===undefined||v[k]===true),'JWT_GRANTS');
}
export function assertParticipants(actual,expected){
  requireFact(Array.isArray(actual)&&actual.length===expected.length&&actual.every(x=>expected.includes(x.identity)&&(x.tracks===undefined||(Array.isArray(x.tracks)&&x.tracks.length===0))),'TRACKS');
}

// Runtime errors are always converted to fixed enums at the command boundary.
export function command(executable,args,{input,timeout=10000,budget}={}){
  if(budget)timeout=budget.remaining(timeout);
  return new Promise((resolve,reject)=>{
    const p=spawn(executable,args,{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME}});const out=[];let size=0,failed;
    const kill=code=>{failed=code;if(p.exitCode===null&&p.signalCode===null&&!p.kill('SIGKILL'))reject(new Error('UNKNOWN'));};
    const timer=setTimeout(()=>kill('DEADLINE'),timeout);
    const aborted=()=>kill(budget.signal.reason==='CLEANUP'?'CANCELLED':'FAIL');budget?.signal?.addEventListener('abort',aborted,{once:true});
    p.stdout.on('data',b=>{size+=b.length;if(size>4194304)kill('OUTPUT_LIMIT');else out.push(b);});p.stderr.on('data',()=>{});
    p.on('error',()=>{clearTimeout(timer);reject(new Error('COMMAND'));});p.on('close',code=>{clearTimeout(timer);budget?.signal?.removeEventListener('abort',aborted);try{if(failed)throw new Error(failed);budget?.remaining();code===0?resolve(Buffer.concat(out).toString()):reject(new Error('COMMAND'));}catch(error){reject(new Error(failed||'DEADLINE'));}});p.stdin.end(input);
  });
}
function protectedFile(file,uid=0,mode,gid=uid){const s=fs.lstatSync(file);requireFact(s.isFile()&&!s.isSymbolicLink()&&s.uid===uid&&(mode===undefined?(s.mode&0o077)===0:(s.mode&0o777)===mode&&s.gid===gid),'PERMISSIONS');return s;}
function privateDir(dir,uid=0){const s=fs.lstatSync(dir);requireFact(s.isDirectory()&&!s.isSymbolicLink()&&s.uid===uid&&(s.mode&0o077)===0,'PERMISSIONS');}
function readContract(action){requireFact(process.platform==='linux'&&process.getuid()===0,'HOLD');privateDir(ROOT);protectedFile(`${ROOT}/runtime.json`);return validateContract(JSON.parse(fs.readFileSync(`${ROOT}/runtime.json`)),action);}
function actualCgroup(dir,read=file=>fs.readFileSync(file,'utf8')){const cpu=read(`${dir}/cpu.max`).trim().split(/\s+/);const memory=Number(read(`${dir}/memory.max`).trim());requireFact(read(`${dir}/memory.swap.max`).trim()==='0','SWAP');return {cpu:Number(cpu[0])/Number(cpu[1]),memory};}
function ownAux(c){
  const rel=fs.readFileSync('/proc/self/cgroup','utf8').trim().split('\n').find(x=>x.startsWith('0::'))?.slice(3),current=rel&&path.resolve('/sys/fs/cgroup'+rel);
  requireFact(current&&(current===c.auxiliary.cgroup||current.startsWith(c.auxiliary.cgroup+'/')),'AUX_CGROUP');
  const row=actualCgroup(c.auxiliary.cgroup);requireFact(row.cpu<=c.auxiliary.cpu&&row.memory<=c.auxiliary.memory,'AUX_CGROUP');return row;
}
function frozenMetadata(row){
  const item=fs.lstatSync(row.path);requireFact(!item.isSymbolicLink()&&item.uid===row.uid&&item.gid===row.gid&&(item.mode&0o777)===row.mode,'PERMISSIONS');
  if(row.kind==='core-directory'||row.kind==='directory')requireFact(item.isDirectory(),'PERMISSIONS');else if(row.kind==='socket')requireFact(item.isSocket(),'PERMISSIONS');else requireFact(item.isFile()||item.isBlockDevice(),'PERMISSIONS');
}
export function assertNodeBinary(file,expected,io=fs){
  const hash=crypto.createHash('sha256'),buffer=Buffer.alloc(65536),fd=io.openSync(file,'r');
  try{
    let count;
    while((count=io.readSync(fd,buffer,0,buffer.length,null))>0)hash.update(buffer.subarray(0,count));
    requireFact(hash.digest('hex')===expected,'NODE');
  }finally{io.closeSync(fd);}
}
function runtimeBoundaries(c){
  requireFact(process.version==='v24.13.0'&&!process.env.NODE_OPTIONS&&!process.env.NODE_TLS_REJECT_UNAUTHORIZED&&!process.env.NODE_EXTRA_CA_CERTS,'NODE');
  assertNodeBinary(process.execPath,c.nodeSha256);
  requireFact(fs.readFileSync('/proc/sys/kernel/core_pattern','utf8').trim()===c.persistence.corePattern,'PERSISTENCE');
  for(const row of [...c.persistence.locations,...c.logging.bypasses])frozenMetadata(row);
  const swaps=fs.readFileSync('/proc/swaps','utf8').trim().split('\n').slice(1).map(x=>x.trim().split(/\s+/)[0]);
  requireFact(swaps.every(name=>c.persistence.locations.some(x=>x.kind==='swap'&&x.path===name)),'PERSISTENCE');
}
function hostsText(c){return '127.0.0.1 localhost\n127.0.0.1 '+c.domain+'\n::1 localhost\n';}
function compose(c,args,budget){return command('docker',['compose','--project-name',c.project,'--file',`${ROOT}/compose.yaml`,...args],{budget});}
async function inspect(id,budget){return JSON.parse(await command('docker',['inspect',id],{budget}))[0];}
async function ownContainers(c,budget){const ids=(await command('docker',['ps','-aq','--filter',`label=com.docker.compose.project=${c.project}`],{budget})).trim().split(/\s+/).filter(Boolean);const rows=[];for(const id of ids){const i=await inspect(id,budget);const service=i.Config.Labels['com.docker.compose.service'];assertOwned(i,c,service);rows.push(i);}requireFact(new Set(rows.map(x=>x.Config.Labels['com.docker.compose.service'])).size===rows.length,'UNKNOWN');return rows;}
function overlaps(a,b){return a===b||a.startsWith(b+'/')||b.startsWith(a+'/');}
export function validateSharedRuntime(c,workload){
  const shared=c.sharedRuntime,validGroup=value=>typeof value==='string'&&/^\/sys\/fs\/cgroup\/[\w.@:-]+(?:\/[\w.@:-]+)*$/.test(value)&&!value.split('/').some(part=>part==='.'||part==='..');
  requireFact(shared&&Number.isSafeInteger(shared.sampleIntervalMs)&&shared.sampleIntervalMs>0&&shared.sampleIntervalMs<=1000&&Number.isFinite(shared.maxCpuPercent)&&shared.maxCpuPercent>0&&Number.isFinite(shared.maxMemoryGrowth)&&shared.maxMemoryGrowth>0,'HOLD');
  const services=shared.services;requireFact(Array.isArray(services)&&services.length===2&&new Set(services.map(row=>row.unit)).size===2,'HOLD');
  for(const row of services)requireFact(['docker.service','containerd.service'].includes(row.unit)&&validGroup(row.cgroup)&&row.cgroup.endsWith('/'+row.unit)&&/^[a-f0-9]{32}$/.test(row.invocationId)&&Number.isSafeInteger(row.pid)&&row.pid>1&&typeof row.startTime==='string'&&/^[1-9]\d*$/.test(row.startTime)&&Number.isSafeInteger(row.inode)&&row.inode>0&&Number.isSafeInteger(row.cpuUsageUsec)&&row.cpuUsageUsec>=0&&Number.isSafeInteger(row.memoryUsageBytes)&&row.memoryUsageBytes>=0,'HOLD');
  const groups=[...workload,...services.map(row=>row.cgroup)];requireFact(groups.every(validGroup)&&groups.every((group,index)=>groups.slice(index+1).every(other=>!overlaps(group,other))),'UNKNOWN');
}
export function assertSharedShim(c,id,args,group,workload){
  validateSharedRuntime(c,workload);requireFact(path.basename(args[0])==='containerd-shim-runc-v2'&&args[args.indexOf('-namespace')+1]==='moby'&&args[args.indexOf('-id')+1]===id,'UNKNOWN');
  requireFact(c.sharedRuntime.services.some(row=>group===row.cgroup||group.startsWith(row.cgroup+'/')),'UNKNOWN');
}
const sharedIO={
  show:async(row,budget)=>Object.fromEntries((await command('systemctl',['show',row.unit,'--property=ActiveState,SubState,MainPID,InvocationID,ControlGroup'],{budget})).trim().split('\n').map(line=>line.split('='))),
  read:(file)=>fs.readFileSync(file,'utf8'),stat:group=>fs.lstatSync(group),realpath:group=>fs.realpathSync(group)
};
export async function containerCgroup(c,i,budget,{read=sharedIO.read,show=async(unit,current)=>Object.fromEntries((await command('systemctl',['show',unit,'--property=Id,ActiveState,SubState,ControlGroup,MemorySwapMax'],{budget:current})).trim().split('\n').map(line=>line.split('=')))}={}){
  assertOwned(i,c,i?.Config?.Labels?.['com.docker.compose.service']);
  try{
    budget.remaining();requireFact(i.State?.Running&&Number.isSafeInteger(i.State.Pid)&&i.State.Pid>1&&!i.State.OOMKilled,'RESOURCES');
    const unit='docker-'+i.Id+'.scope',rel='/system.slice/'+unit,group='/sys/fs/cgroup'+rel;
    requireFact(read('/proc/'+i.State.Pid+'/cgroup').trim()==='0::'+rel,'UNKNOWN');
    const state=await show(unit,budget);budget.remaining();
    requireFact(state.Id===unit&&state.ActiveState==='active'&&state.SubState==='running'&&state.ControlGroup===rel,'UNKNOWN');
    requireFact(state.MemorySwapMax==='0','SWAP');const resources=actualCgroup(group,read);budget.remaining();return {cgroup:group,...resources};
  }catch(error){throw new Error(['SWAP','UNKNOWN','RESOURCES','DEADLINE','FAIL','CANCELLED'].includes(error.message)?error.message:'HOLD');}
}
export async function assertNativeBaseline(c,budget,show=sharedIO.show){
  for(const [index,row] of c.nativeBaseline.entries()){
    budget.remaining();const state=await show(row,budget);budget.remaining();const detail={index:index+1,code:'FAIL'};
    requireBaseline(state.ActiveState==='active','BASELINE_NATIVE_ACTIVE',detail);
    requireBaseline(state.SubState==='running','BASELINE_NATIVE_SUBSTATE',detail);
    requireBaseline(state.MainPID===String(row.pid),'BASELINE_NATIVE_PID',detail);
    requireBaseline(state.InvocationID===row.invocationId,'BASELINE_NATIVE_INVOCATION',detail);
  }
}
export async function sharedServiceRows(c,budget,io=sharedIO){
  const rows=[];for(const row of c.sharedRuntime.services){budget.remaining();const state=await io.show(row,budget),stat=io.stat(row.cgroup),proc=io.read('/proc/'+row.pid+'/stat');
    requireFact(state.ActiveState==='active'&&state.SubState==='running'&&state.MainPID===String(row.pid)&&state.InvocationID===row.invocationId&&'/sys/fs/cgroup'+state.ControlGroup===row.cgroup&&stat.isDirectory()&&!stat.isSymbolicLink()&&stat.ino===row.inode&&io.realpath(row.cgroup)===row.cgroup,'UNKNOWN');
    requireFact(proc.slice(proc.lastIndexOf(')')+2).trim().split(/\s+/)[19]===row.startTime&&path.basename(io.read('/proc/'+row.pid+'/cmdline').split('\0')[0])===(row.unit==='docker.service'?'dockerd':'containerd')&&io.read('/proc/'+row.pid+'/cgroup').trim()==='0::'+row.cgroup.slice('/sys/fs/cgroup'.length),'UNKNOWN');rows.push({...row,kind:'shared'});
  }return rows;
}
const resourceCounters=new Map();
export async function sampleResources(c,rows,budget,{read=sharedIO.read,now=()=>Number(process.hrtime.bigint())/1000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),previous=resourceCounters}={}){
  const counters=row=>{try{const cpu=read(row.cgroup+'/cpu.stat'),usage=cpu.match(/^usage_usec (\d+)$/m)?.[1],memory=read(row.cgroup+'/memory.current').trim();requireFact(usage!==undefined&&cpu.split('\n').filter(line=>line.startsWith('usage_usec')).length===1&&/^\d+$/.test(memory),'HOLD');const result={usage:Number(usage),memory:Number(memory)};requireFact(Number.isSafeInteger(result.usage)&&Number.isSafeInteger(result.memory),'HOLD');return result;}catch(error){throw new Error(['FAIL','UNKNOWN','DEADLINE'].includes(error.message)?error.message:'HOLD');}};
  const before=rows.map(row=>{const start=counters(row);requireFact(start.usage>=(row.cpuUsageUsec??0)&&start.usage>=(previous.get(row.cgroup)??0),'UNKNOWN');return {row,start,at:now()};});
  await sleep(budget.remaining(100));let sharedCpu=0,sharedMemory=0;
  for(const {row,start,at} of before){budget.remaining();const end=counters(row),elapsed=now()-at;requireFact(Number.isFinite(elapsed)&&elapsed>0&&end.usage>=start.usage,'UNKNOWN');const cpu=(end.usage-start.usage)/elapsed*100,growth=Math.max(0,Math.max(start.memory,end.memory)-row.memoryUsageBytes);requireFact(Number.isFinite(cpu)&&Number.isFinite(growth),'HOLD');previous.set(row.cgroup,end.usage);
    if(row.kind==='shared'){sharedCpu+=cpu;sharedMemory+=growth;}else{requireFact(cpu<=c.thresholds.maxOldCpuPercent,'FAIL','OLD_CPU');requireFact(growth<=c.thresholds.maxOldMemoryGrowth,'FAIL','OLD_MEMORY');}
  }
  requireFact(Number.isSafeInteger(sharedMemory),'FAIL');requireFact(sharedCpu<=c.sharedRuntime.maxCpuPercent,'FAIL','SHARED_CPU');requireFact(sharedMemory<=c.sharedRuntime.maxMemoryGrowth,'FAIL','SHARED_MEMORY');return {sharedCpu,sharedMemory};
}
export function sameMounts(actual,frozen){
  if(!Array.isArray(actual)||!Array.isArray(frozen)||actual.length!==frozen.length)return false;
  const remaining=[...frozen];
  for(const mount of actual){const index=remaining.findIndex(row=>isDeepStrictEqual(mount,row));if(index<0)return false;remaining.splice(index,1);}
  return true;
}
export function assertHostBaseline(c,{freeMemory,load,freeDisk}){
  requireBaseline(freeMemory>=c.thresholds.minFreeMemory,'BASELINE_MEMORY',{actual:freeMemory,limit:c.thresholds.minFreeMemory});
  requireBaseline(load<=c.thresholds.maxLoad,'BASELINE_LOAD',{actual:Math.ceil(load*1000),limit:Math.floor(c.thresholds.maxLoad*1000)});
  requireBaseline(freeDisk>=c.thresholds.minFreeDisk,'BASELINE_DISK',{actual:freeDisk,limit:c.thresholds.minFreeDisk});
}
export function assertContainerBaseline(frozen,current,index){
  const detail={index};
  requireBaseline(current.Image===frozen.image,'BASELINE_IMAGE',detail);
  requireBaseline(current.State.Status===frozen.status,'BASELINE_STATE',detail);
  requireBaseline(sameMounts(current.Mounts,frozen.mounts),'BASELINE_MOUNTS',detail);
  requireBaseline(Number.isSafeInteger(frozen.memoryUsageBytes)&&frozen.memoryUsageBytes>=0,'BASELINE_COUNTER',detail);
}
async function baseline(c,budget){
  budget.remaining();
  await assertNativeBaseline(c,budget);
  const disk=fs.statfsSync(ROOT);assertHostBaseline(c,{freeMemory:os.freemem(),load:os.loadavg()[0],freeDisk:disk.bavail*disk.bsize});
  const samples=[];
  for(const [index,b] of c.baseline.entries()){const i=await inspect(b.id,budget);assertContainerBaseline(b,i,index+1);
    const rel=fs.readFileSync(`/proc/${i.State.Pid}/cgroup`,'utf8').split('\n').find(x=>x.startsWith('0::'))?.slice(3).trim();requireBaseline(rel,'BASELINE_CGROUP',{index:index+1});
    samples.push({cgroup:'/sys/fs/cgroup'+rel,memoryUsageBytes:b.memoryUsageBytes,kind:'old'});
  }
  samples.push(...await sharedServiceRows(c,budget));return sampleResources(c,samples,budget);
}
async function cgroups(c,containers,budget){
  budget.remaining();
  const rows=[ownAux(c)],groups=[c.auxiliary.cgroup],shims=[];
  for(const i of containers){assertOwned(i,c,i.Config.Labels['com.docker.compose.service']);requireFact(i.State.Running&&i.State.Pid>0&&!i.State.OOMKilled,'RESOURCES');
    const resources=await containerCgroup(c,i,budget);groups.push(resources.cgroup);rows.push(resources);
    const status=fs.readFileSync(`/proc/${i.State.Pid}/status`,'utf8');const parent=Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);requireFact(parent>1,'SHIM');
    const args=fs.readFileSync(`/proc/${parent}/cmdline`,'utf8').split('\0');
    const shimRel=fs.readFileSync(`/proc/${parent}/cgroup`,'utf8').split('\n').find(x=>x.startsWith('0::'))?.slice(3).trim();shims.push({id:i.Id,args,group:'/sys/fs/cgroup'+shimRel});
  }
  validateSharedRuntime(c,groups);for(const shim of shims)assertSharedShim(c,shim.id,shim.args,shim.group,groups);
  assertResources(rows);return rows;
}
async function preflight(c,budget,{port=true}={}){
  budget.remaining();
  for(const name of SOURCE_FILES){const file=`${ROOT}/${name}`;requireFact(!fs.lstatSync(file).isSymbolicLink()&&crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')===c.sourceHashes[name],'SOURCE');}
  runtimeBoundaries(c);
  requireFact(fs.readFileSync('/sys/class/dmi/id/product_uuid','utf8').trim()===c.machineUuid&&typeof c.machineUuid==='string','HOST');
  ownAux(c);await baseline(c,budget);
  privateDir(`${ROOT}/secrets`);privateDir(`${ROOT}/data`,991);privateDir(`${ROOT}/events`);
  protectedFile(`${ROOT}/secrets/tls.key`);protectedFile(`${ROOT}/secrets/tls.crt`);
  const cert=fs.readFileSync(`${ROOT}/secrets/tls.crt`);requireFact(crypto.createHash('sha256').update(cert).digest('hex')===c.certificateSha256,'TLS');
  const x=new crypto.X509Certificate(cert);requireFact(x.checkHost(c.domain)&&Date.parse(x.validTo)>Date.now(),'TLS');
  const info=JSON.parse(await command('docker',['info','--format','{{json .}}'],{budget}));requireFact(info.OSType==='linux'&&info.Architecture==='x86_64'&&info.CgroupVersion==='2'&&info.CgroupDriver==='systemd','PLATFORM');
  for(const [service,p] of Object.entries(PINS)){const i=JSON.parse(await command('docker',['image','inspect',p.image],{budget}))[0];assertPinnedImage(i,service);}
  if(port)await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>reject(new Error('BUSY')));s.listen(c.port,'127.0.0.1',()=>s.close(resolve));});
  budget.remaining();
}
function yamlString(x){return JSON.stringify(x);}
function render(c,text,values){return text.replace(/\{\{([A-Z_]+)\}\}/g,(_,key)=>{requireFact(Object.hasOwn(values,key),'TEMPLATE');return values[key];});}
export function templateValues(c,secrets){return {...Object.fromEntries(Object.entries(secrets).map(([k,v])=>[k,yamlString(v)])),DOMAIN:yamlString(c.domain),DOMAIN_RAW:c.domain,SERVER_NAME:yamlString(serverName(c)),SERVER_REGEX:serverName(c).replaceAll('.','\\.'),PORT:String(c.port),RUN_ID:c.runId,ROOT};}
async function configure(c,budget){
  await preflight(c,budget);requireFact((await ownContainers(c,budget)).length===0,'BUSY');
  const fresh=()=>crypto.randomBytes(32).toString('hex');
  const secrets={AS_TOKEN:fresh(),HS_TOKEN:fresh(),REGISTRATION_SECRET:fresh(),MACAROON_SECRET:fresh(),FORM_SECRET:fresh(),LIVEKIT_KEY:fresh(),LIVEKIT_SECRET:fresh()};
  const values=templateValues(c,secrets);
  const targets=[['homeserver.yaml.example','secrets/homeserver.yaml',991,991,0o400],['appservice-registration.yaml.example','secrets/appservice.yaml',0,991,0o440],['livekit.yaml.example','secrets/livekit.yaml',0,0,0o400],['Caddyfile','secrets/Caddyfile',0,0,0o400]];
  for(const [,target] of targets)requireFact(!fs.existsSync(`${ROOT}/${target}`),'BUSY');
  for(const [source,target,uid,gid,mode] of targets){const out=render(c,fs.readFileSync(`${ROOT}/${source}`,'utf8'),values);fs.writeFileSync(`${ROOT}/${target}`,out,{flag:'wx',mode});fs.chownSync(`${ROOT}/${target}`,uid,gid);}
  fs.writeFileSync(ROOT+'/secrets/log.config',SYNAPSE_LOG,{flag:'wx',mode:0o400});fs.chownSync(ROOT+'/secrets/log.config',991,991);
  fs.writeFileSync(`${ROOT}/secrets/livekit.key`,secrets.LIVEKIT_KEY,{flag:'wx',mode:0o400});fs.writeFileSync(`${ROOT}/secrets/livekit.secret`,secrets.LIVEKIT_SECRET,{flag:'wx',mode:0o400});
  const env=`RTC_DOMAIN=${c.domain}\nRTC_PORT=${c.port}\nRTC_RUN_ID=${c.runId}\n`;fs.writeFileSync(`${ROOT}/.env`,env,{flag:'wx',mode:0o400});
  fs.writeFileSync(ROOT+'/hosts',hostsText(c),{flag:'wx',mode:0o400});
  await compose(c,['config','--quiet'],budget);
}
const SYNAPSE_LOG='version: 1\nhandlers:\n  stderr: {class: logging.StreamHandler, level: WARNING, stream: ext://sys.stderr}\nroot: {level: WARNING, handlers: [stderr]}\ndisable_existing_loggers: false\n';
function validateGenerated(c){
  const files=[['homeserver.yaml',991],['appservice.yaml',0,0o440,991],['livekit.yaml',0],['Caddyfile',0],['livekit.key',0],['livekit.secret',0],['log.config',991]];
  for(const [name,uid,mode,gid] of files)protectedFile(`${ROOT}/secrets/${name}`,uid,mode,gid);
  requireFact(fs.readFileSync(ROOT+'/secrets/log.config','utf8')===SYNAPSE_LOG,'CONFIG');
  protectedFile(ROOT+'/hosts');requireFact(fs.readFileSync(ROOT+'/hosts','utf8')===hostsText(c),'DNS');
  protectedFile(`${ROOT}/.env`);requireFact(fs.readFileSync(`${ROOT}/.env`,'utf8')===`RTC_DOMAIN=${c.domain}\nRTC_PORT=${c.port}\nRTC_RUN_ID=${c.runId}\n`,'CONFIG');
  const homeserver=fs.readFileSync(`${ROOT}/secrets/homeserver.yaml`,'utf8'),registration=fs.readFileSync(`${ROOT}/secrets/appservice.yaml`,'utf8');
  const secrets={};for(const [key,yaml,text] of [['AS_TOKEN','as_token',registration],['HS_TOKEN','hs_token',registration],['REGISTRATION_SECRET','registration_shared_secret',homeserver],['MACAROON_SECRET','macaroon_secret_key',homeserver],['FORM_SECRET','form_secret',homeserver]]){
    const value=JSON.parse(text.match(new RegExp('^'+yaml+': (.+)$','m'))?.[1]??'null');requireFact(typeof value==='string'&&/^[a-f0-9]{64}$/.test(value),'CONFIG');secrets[key]=yamlString(value);
  }
  for(const [key,name] of [['LIVEKIT_KEY','livekit.key'],['LIVEKIT_SECRET','livekit.secret']]){const value=fs.readFileSync(`${ROOT}/secrets/${name}`,'utf8');requireFact(/^[a-f0-9]{64}$/.test(value),'CONFIG');secrets[key]=yamlString(value);}
  const values={...templateValues(c,{}),...secrets};
  for(const [template,target] of [['homeserver.yaml.example','homeserver.yaml'],['appservice-registration.yaml.example','appservice.yaml'],['livekit.yaml.example','livekit.yaml'],['Caddyfile','Caddyfile']])requireFact(render(c,fs.readFileSync(`${ROOT}/${template}`,'utf8'),values)===fs.readFileSync(`${ROOT}/secrets/${target}`,'utf8'),'CONFIG');
  return [...Object.values(secrets).map(x=>JSON.parse(x)),fs.readFileSync(ROOT+'/secrets/tls.key','utf8')];
}

function ownershipPath(c){return `${ROOT}/ownership-${c.runId}.json`;}
function readOwnership(c){protectedFile(ownershipPath(c));return JSON.parse(fs.readFileSync(ownershipPath(c),'utf8'));}
function writeOwnership(c,containers){
  const receipt={version:1,host:c.host,machineUuid:c.machineUuid,project:c.project,runId:c.runId,containers:containers.map(i=>({id:i.Id,service:i.Config.Labels['com.docker.compose.service'],image:i.Config.Image,imageId:i.Image,created:i.Created}))};
  const fd=fs.openSync(ownershipPath(c),'wx',0o400);try{fs.writeFileSync(fd,JSON.stringify(receipt)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const directory=fs.openSync(ROOT,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}return receipt;
}
const recoveryIO={machine:()=>fs.readFileSync('/sys/class/dmi/id/product_uuid','utf8').trim(),inspect,unpause:(id,budget)=>command('docker',['unpause',id],{budget}),stop:(id,budget)=>command('docker',['stop','--time','3',id],{budget}),sample:async(c,budget)=>{await baseline(c,budget);await cgroups(c,(await ownContainers(c,budget)).filter(row=>row.State.Running),budget);}};
function recordCleanup(events,stage,error,service='verifier'){try{events?.event(service,stage,0,error);}catch{}}
export async function stopOwned(c,receipt,budget,io=recoveryIO,onFailure){
  let unknown=false,resourceFault,stage='cleanup_receipt',service='verifier';
  const report=error=>{try{onFailure?.(stage,error,stage==='cleanup_sample'?'verifier':service);}catch{}};
  const sample=async()=>{stage='cleanup_sample';try{await io.sample?.(c,budget);}catch(error){if(error.message==='DEADLINE')throw error;report(error);resourceFault??=['FAIL','HOLD','UNKNOWN'].includes(error.message)?error.message:'UNKNOWN';}};
  try{
    budget.remaining();requireFact(receipt?.version===1&&receipt.host===c.host&&receipt.runId===c.runId&&receipt.project===c.project&&receipt.machineUuid===c.machineUuid&&io.machine()===c.machineUuid,'UNKNOWN');
    requireFact(Array.isArray(receipt.containers)&&receipt.containers.length===4&&new Set(receipt.containers.map(x=>x.id)).size===4&&new Set(receipt.containers.map(x=>x.service)).size===4,'UNKNOWN');
    for(const row of [...receipt.containers].reverse()){
      stage='cleanup_receipt';service=row.service;budget.remaining();
      try{
        requireFact(SERVICES.includes(row.service)&&row.image===PINS[row.service].image&&/^[a-f0-9]{64}$/.test(row.id)&&/^sha256:[a-f0-9]{64}$/.test(row.imageId)&&typeof row.created==='string','UNKNOWN');
        const verify=i=>{assertOwned(i,c,row.service);requireFact(i.Id===row.id&&i.Image===row.imageId&&i.Created===row.created,'UNKNOWN');};
        await sample();stage='cleanup_inspect';let current=await io.inspect(row.id,budget);budget.remaining();verify(current);
        if(current.State.Paused){stage='cleanup_unpause';requireFact(row.service==='synapse'&&typeof io.unpause==='function','UNKNOWN');await io.unpause(row.id,budget);budget.remaining();current=await io.inspect(row.id,budget);budget.remaining();verify(current);requireFact(!current.State.Paused,'UNKNOWN');}
        if(current.State.Running){stage='cleanup_stop';budget.remaining();await io.stop(row.id,budget);}
        stage='cleanup_stopped';const after=await io.inspect(row.id,budget);budget.remaining();verify(after);requireFact(!after.State.Running&&after.State.Pid===0&&after.State.Paused===false,'UNKNOWN');await sample();
      }catch(error){if(error.message==='DEADLINE')throw error;report(error);unknown=true;}
    }
    budget.remaining();return unknown?'UNKNOWN':resourceFault??'OK';
  }catch(error){report(error);return error.message==='DEADLINE'?'DEADLINE':'UNKNOWN';}
}
export async function cleanupHook(c,events,{admit=ownAux,acquireBudget=()=>cleanupBudget(c),readReceipt=readOwnership,recovery=recoveryIO,checkBaseline=baseline,stopWorker=false,stopWorkerUnit=stopUnit,checkUnit=unitStopped}={}){
  let stage='cleanup_admission';
  try{
    admit(c);stage='cleanup_budget';const budget=acquireBudget();
    if(stopWorker){stage='cleanup_worker';await stopWorkerUnit(c,budget);}
    stage='cleanup_receipt';budget.remaining();const receipt=readReceipt(c);stage='cleanup_result';
    const result=await stopOwned(c,receipt,budget,recovery,(failed,error,service)=>recordCleanup(events,failed,error,service));
    requireFact(result==='OK',result);stage='cleanup_baseline';await checkBaseline(c,budget);
    if(stopWorker){stage='cleanup_unit';await checkUnit(c,budget);}
    events?.event('verifier','cleanup_result',0,'OK');
  }catch(error){recordCleanup(events,stage,error);throw error;}
}
export async function startExperiment(c,budget,io){
  let launched=false;
  try{
    budget.remaining();await io.preflight(c,budget);budget.remaining();await io.launch(c,budget);launched=true;
    while(true){budget.remaining();const status=await io.status(c,budget);budget.remaining();if(status.status==='OK')return;await new Promise(r=>setTimeout(r,budget.remaining(25)));}
  }catch(error){if(launched)await io.recover(c);throw error;}
}

export function assertMembershipDenial(response){
  const parsed=JSON.parse(response.body);requireFact(response.status===403&&parsed.errcode==='M_FORBIDDEN'&&!parsed.jwt,'DENIAL');return {status:response.status,errcode:parsed.errcode};
}

export function roomAlias(room){return crypto.createHash('sha256').update(JSON.stringify([room,'m.call#ROOM'])).digest('base64').replace(/=+$/,'');}
function jwt(claims,secret){const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const p=Buffer.from(JSON.stringify(claims)).toString('base64url');return `${h}.${p}.${crypto.createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`;}
function ticketJson(part,code){
  let value;try{value=JSON.parse(Buffer.from(part,'base64url').toString('utf8'));}catch{throw new Error(code);}
  requireFact(value&&typeof value==='object'&&!Array.isArray(value),code);return value;
}
export function decodeTicket(token,secret){
  requireFact(typeof token==='string','JWT_FORMAT');const parts=token.split('.');
  requireFact(parts.length===3&&parts.every(part=>/^[A-Za-z0-9_-]+$/.test(part)),'JWT_FORMAT');
  const signature=crypto.createHmac('sha256',secret).update(parts.slice(0,2).join('.')).digest(),received=Buffer.from(parts[2],'base64url');
  requireFact(received.length===signature.length&&crypto.timingSafeEqual(signature,received),'JWT_SIGNATURE');
  requireFact(ticketJson(parts[0],'JWT_HEADER').alg==='HS256','JWT_HEADER');return ticketJson(parts[1],'JWT_FORMAT');
}

function lookupLoopback(host,options,callback){callback(null,options.all?[{address:'127.0.0.1',family:4}]:'127.0.0.1',4);}
function statePath(c){return ROOT+'/state-'+c.runId+'.json';}
function writeState(c,phase,deadline){
  requireFact(['READY','VERIFYING','VERIFIED','FAIL'].includes(phase),'STATE');
  const file=statePath(c),temporary=file+'.new';
  fs.writeFileSync(temporary,JSON.stringify({runId:c.runId,phase,deadline})+'\n',{flag:'wx',mode:0o400});fs.renameSync(temporary,file);
}
function readState(c){protectedFile(statePath(c));const state=JSON.parse(fs.readFileSync(statePath(c),'utf8'));requireFact(state.runId===c.runId&&['READY','VERIFYING','VERIFIED','FAIL'].includes(state.phase)&&Number.isFinite(state.deadline),'STATE');return state;}
function cleanupBudget(c){
  const file=ROOT+'/cleanup-'+c.runId+'.deadline';
  if(!fs.existsSync(file))fs.writeFileSync(file,String(new Budget(60000).end),{flag:'wx',mode:0o400});
  protectedFile(file);return Budget.fromDeadline(Number(fs.readFileSync(file,'utf8')));
}
export class ResourceWatch {
  constructor(sample,budget,interval){this.read=sample;this.budget=budget;this.interval=interval;this.controller=new AbortController();this.timer=null;this.pending=null;this.fault=null;this.closed=false;budget.guard=()=>{this.check();requireFact(!this.closed,'CANCELLED');};budget.signal=this.controller.signal;}
  check(){if(this.fault)throw this.fault;}
  async sample(){
    this.check();requireFact(!this.closed,'FAIL');if(!this.pending)this.pending=(async()=>{try{await this.read(this.budget);this.budget.remaining();}catch(error){if(!(this.closed&&error.message==='CANCELLED')){this.fault??=new Error(['FAIL','HOLD','UNKNOWN','DEADLINE'].includes(error.message)?error.message:'HOLD',{cause:error});this.controller.abort();}}finally{this.pending=null;}})();
    await this.pending;this.check();
  }
  schedule(){if(this.closed||this.fault)return;try{this.timer=setTimeout(()=>{this.timer=null;this.sample().catch(()=>{}).finally(()=>this.schedule());},this.budget.remaining(this.interval));}catch(error){this.fault??=new Error(error.message==='DEADLINE'?'DEADLINE':'HOLD');this.controller.abort();}}
  async start(){await this.sample();this.schedule();}
  async close(budget){
    this.closed=true;clearTimeout(this.timer);this.timer=null;this.controller.abort('CLEANUP');
    let timer;try{if(budget){await Promise.race([this.pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DEADLINE')),budget.remaining());})]);budget.remaining();}else await this.pending;}finally{clearTimeout(timer);}
  }
}
function runtimeEvents(c){return new SafeEvents(event=>{
  fs.appendFileSync(ROOT+'/events/'+c.runId+'.jsonl',JSON.stringify({...event,time:new Date().toISOString()})+'\n',{mode:0o600,flag:'a'});
});}
export class Runtime {
  constructor(c,budget){this.c=c;this.budget=budget;this.startedAt=new Date().toISOString();this.attaches=new Map();this.connections=[];this.logCases=new Set();this.loggingAdmitted=false;this.events=runtimeEvents(c);}
  recordFailure(error){this.events.event('verifier','fault',0,this.monitor?.fault??error);}
  async start(budget){
    await preflight(this.c,budget);this.secrets=validateGenerated(this.c);for(const secret of this.secrets)this.events.watch(secret);
    requireFact(fs.readFileSync('/etc/hosts','utf8')===hostsText(this.c),'DNS');
    this.freezeSyslog(budget);
    this.sentinel='incapable-'+crypto.randomBytes(24).toString('hex');this.events.watch(this.sentinel);
    await expectFailure(httpRequest('https://'+serverName(this.c)+'/_matrix/client/versions',{token:this.sentinel,lookup:lookupLoopback,timeout:budget.remaining(8000),signal:budget.signal}),'CONNECTION',budget);this.logCases.add('connection');this.events.event('verifier','log_connection');
    this.monitor=new ResourceWatch(async current=>{this.events.check();const measured=await baseline(this.c,current),containers=await ownContainers(this.c,current);if(this.ready){requireFact(containers.length===4&&containers.every(row=>row.State.Running),'FAIL');for(const row of containers)assertContainerConfiguration(row,this.c,row.Config.Labels['com.docker.compose.service']);}await cgroups(this.c,containers.filter(row=>row.State.Running),current);this.events.event('verifier','shared_cpu_milli',0,'OK',Math.ceil(measured.sharedCpu*10));this.events.event('verifier','shared_memory_bytes',0,'OK',measured.sharedMemory);},budget,this.c.sharedRuntime.sampleIntervalMs);await this.monitor.start();
    await compose(this.c,['create','--pull','never'],budget);
    const containers=await ownContainers(this.c,budget);requireFact(containers.length===4,'OWNERSHIP');writeOwnership(this.c,containers);
    for(const i of containers){assertContainerConfiguration(i,this.c,i.Config.Labels['com.docker.compose.service']);requireFact(i.HostConfig.MemorySwap===i.HostConfig.Memory&&i.HostConfig.Memory>0&&i.HostConfig.NanoCpus>0,'CONFIG');}
    for(const service of SERVICES){
      budget.remaining();const i=containers.find(x=>x.Config.Labels['com.docker.compose.service']===service);assertOwned(i,this.c,service);
      const child=spawn('docker',['start','--attach',i.Id],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,HOME:process.env.HOME}});
      const state={child,ended:false,id:i.Id};this.attaches.set(service,state);
      child.stdout.on('data',b=>this.events.consume(service,b,'stdout'));child.stderr.on('data',b=>this.events.consume(service,b,'stderr'));
      child.on('error',()=>{state.ended=true;});child.on('close',()=>{state.ended=true;});
      while(!(await inspect(i.Id,budget)).State.Running){requireFact(!state.ended,'START');await new Promise(r=>setTimeout(r,budget.remaining(25)));}
      await this.monitor.sample();this.events.event(service,'started');
    }
    const running=await ownContainers(this.c,budget);
    for(const i of running)assertContainerConfiguration(i,this.c,i.Config.Labels['com.docker.compose.service']);
    const networks=JSON.parse(await command('docker',['network','inspect',this.c.project+'_isolated',this.c.project+'_ingress'],{budget}));
    assertNetworkTopology(this.c,running,networks);
    this.ready=true;
    await this.audit(budget);
    await this.waitReady(budget);
    await this.sentinels(budget);
    const livekit=await httpRequest('https://'+serverName(this.c)+'/twirp/livekit.RoomService/ListParticipants',{method:'POST',body:'{}',lookup:lookupLoopback,timeout:budget.remaining(8000),signal:budget.signal,headers:{'Content-Type':'application/json'}});budget.remaining();
    requireFact(livekit.status===401,'READINESS');
  }
  async audit(budget){
    budget.remaining();this.events.check();await this.monitor.sample();
    requireFact([...this.attaches.values()].every(x=>!x.ended),'ATTACH');
    for(const connection of this.connections)connection.assertClean();
  }
  async waitReady(budget){
    let attempts=0,last;
    while(true){
      budget.remaining();attempts++;
      try{await this.api('/_matrix/client/versions',{},budget);budget.remaining();this.events.event('verifier','readiness',200,'OK',attempts);return;}
      catch(error){
        const status=Number.isInteger(error.status)&&error.status>=100&&error.status<600?error.status:0,key=(knownFailure(error)?.message??'UNKNOWN')+':'+status;
        if(key!==last){this.events.event('verifier','readiness',status,error,attempts);last=key;}
        await new Promise(resolve=>setTimeout(resolve,budget.remaining(1000)));
      }
    }
  }
  async api(route,{method='GET',body,token,expected=200}={},budget){
    if(token||body!==undefined)requireFact(this.loggingAdmitted===true,'LOG_ADMISSION');if(token)this.events.watch(token);
    const r=await httpRequest('https://'+serverName(this.c)+route,{method,body:body===undefined?undefined:JSON.stringify(body),token,lookup:lookupLoopback,timeout:budget.remaining(8000),signal:budget.signal,headers:body===undefined?{}:{'Content-Type':'application/json'}});budget.remaining();
    this.events.event('verifier','http',r.status,r.status===expected?'OK':'FAIL');
    if(r.status!==expected)throw Object.assign(new Error('HTTP'),{status:r.status});
    try{return JSON.parse(r.body);}catch{throw Object.assign(new Error('BODY'),{status:r.status});}
  }
  async auth(body,budget){requireFact(this.loggingAdmitted===true||this.sentinel===body?.openid_token?.access_token&&typeof this.sentinel==='string','LOG_ADMISSION');this.events.watch(body.openid_token.access_token);const result=await httpRequest('https://'+serverName(this.c)+'/sfu/get',{method:'POST',body:JSON.stringify(body),lookup:lookupLoopback,timeout:budget.remaining(8000),signal:budget.signal,headers:{'Content-Type':'application/json'}});budget.remaining();return result;}
  async stop(){
    let stage='cleanup_budget';
    try{
    const budget=this.cleanup??=cleanupBudget(this.c);
    stage='cleanup_monitor';await this.monitor?.close(budget);budget.remaining();
    stage='cleanup_sockets';
    for(const connection of this.connections)connection.socket.close();
    stage='cleanup_receipt';const receipt=readOwnership(this.c);
    stage='cleanup_result';const result=await stopOwned(this.c,receipt,budget,undefined,(failed,error,service)=>recordCleanup(this.events,failed,error,service));
    stage='cleanup_attaches';
    await budget.waitFor(()=>[...this.attaches.values()].every(x=>x.ended));
    stage='cleanup_sockets';
    await budget.waitFor(()=>this.connections.every(x=>x.socket.readyState===WebSocket.CLOSED));
    for(const service of SERVICES)this.events.event(service,'stopped');
    stage='cleanup_baseline';await baseline(this.c,budget);stage='cleanup_result';requireFact(result==='OK',result);stage='cleanup_monitor';this.monitor?.check();stage='cleanup_sockets';for(const connection of this.connections)connection.assertClean();stage='cleanup_scan';await this.scan([this.sentinel,...this.secrets],budget);this.events.check();this.events.event('verifier','chunks',0,'OK',this.events.chunks);
    }catch(error){recordCleanup(this.events,stage,error);throw error;
    }finally{this.closeSyslog?.();}
  }
}

// Only inspect the fixed protocol's JoinResponse; Node owns RFC6455 and TLS.
// Protocol source: livekit/protocol 129001aa5ff0, livekit_rtc/models.proto.
export function protobufFields(bytes){
  const data=Buffer.from(bytes);requireFact(data.length<=1048576,'BODY_LIMIT');let p=0;
  const variable=()=>{let n=0,scale=1;for(let i=0;i<8&&p<data.length;i++){const b=data[p++];n+=(b&127)*scale;requireFact(Number.isSafeInteger(n),'SIGNAL');if(!(b&128))return n;scale*=128;}throw new Error('SIGNAL');};
  const fields=[];while(p<data.length){const tag=variable(),field=Math.floor(tag/8),wire=tag%8;requireFact(field>0,'SIGNAL');let value;
    if(wire===0)value=variable();else{const length=wire===2?variable():wire===1?8:wire===5?4:-1;requireFact(length>=0&&p+length<=data.length,'SIGNAL');value=data.subarray(p,p+length);p+=length;}
    fields.push({field,wire,value});
  }return fields;
}
export function assertJoin(data,identity,room){
  const response=protobufFields(data),joins=response.filter(x=>x.field===1&&x.wire===2);requireFact(joins.length===1&&response.length===1,'JOIN');
  const join=protobufFields(joins[0].value),own=join.filter(x=>x.field===2&&x.wire===2);requireFact(own.length===1&&!join.some(x=>x.field===7),'JOIN');
  const rooms=join.filter(x=>x.field===1&&x.wire===2);requireFact(rooms.length===1,'JOIN');
  const roomNames=protobufFields(rooms[0].value).filter(x=>x.field===2&&x.wire===2);requireFact(roomNames.length===1&&roomNames[0].value.toString('utf8')===room,'JOIN');
  for(const row of [...own,...join.filter(x=>x.field===3&&x.wire===2)])requireFact(!protobufFields(row.value).some(x=>x.field===4),'TRACKS');
  const names=protobufFields(own[0].value).filter(x=>x.field===2&&x.wire===2);requireFact(names.length===1&&names[0].value.toString('utf8')===identity,'JOIN');return true;
}
export function signal(url,token,{timeout=8000,identity,room,allowWsFixture=false,abortSignal}={}){
  const u=new URL(url);requireFact((u.protocol==='wss:'||(allowWsFixture&&u.protocol==='ws:'&&u.hostname==='127.0.0.1'))&&!u.search&&!u.hash&&!u.username&&!u.password&&['','/'].includes(u.pathname),'TLS');
  requireFact(timeout>0&&timeout<=10000&&typeof identity==='string'&&identity.length>0&&typeof room==='string'&&room.length>0,'SIGNAL');u.pathname='/rtc';
  requireFact(!abortSignal?.aborted,'FAIL');
  return new Promise((resolve,reject)=>{
    const socket=new WebSocket(u,{headers:{Authorization:`Bearer ${token}`}});socket.binaryType='arraybuffer';let joined=false,fault=false,settled=false,expectedRemoval=false;
    const fail=code=>{fault=true;if(!settled){settled=true;clearTimeout(timer);reject(new Error(code));}socket.close();};
    const timer=setTimeout(()=>fail('DEADLINE'),timeout);
    const aborted=()=>{if(expectedRemoval&&abortSignal.reason==='CLEANUP')socket.close();else fail('FAIL');};abortSignal?.addEventListener('abort',aborted,{once:true});
    socket.addEventListener('error',()=>fail('NETWORK'));
    socket.addEventListener('close',()=>{abortSignal?.removeEventListener('abort',aborted);if(!joined)fail('SIGNAL');});
    socket.addEventListener('message',event=>{try{
      requireFact(event.data instanceof ArrayBuffer,'SIGNAL');
      if(!joined){assertJoin(new Uint8Array(event.data),identity,room);joined=true;settled=true;clearTimeout(timer);resolve({socket,joined,expectRemoval:()=>{expectedRemoval=true;},assertClean:()=>requireFact(!fault&&(expectedRemoval||socket.readyState===WebSocket.OPEN),'SIGNAL')});}
      else{const fields=protobufFields(new Uint8Array(event.data));requireFact(!fields.some(x=>x.field===6),'TRACKS');for(const leave of fields.filter(x=>x.field===8)){requireFact(expectedRemoval&&leave.wire===2,'SIGNAL');protobufFields(leave.value);}for(const update of fields.filter(x=>x.field===5&&x.wire===2))for(const person of protobufFields(update.value).filter(x=>x.field===1&&x.wire===2))requireFact(!protobufFields(person.value).some(x=>x.field===4),'TRACKS');}
    }catch{fail('SIGNAL');}});
  });
}
export async function retireParticipants(connections,identities,remove,list){
  requireFact(connections.length===identities.length,'SIGNAL');
  for(let index=0;index<identities.length;index++){connections[index].expectRemoval();await remove(identities[index]);}
  assertParticipants(await list(),[]);for(const connection of connections)connection.assertClean();
}
export function systemdArguments(c,budget=new Budget(120000)){
  return ['--unit=rtc-r0-'+c.runId,'--description=BabaCom RTC '+c.runId,'--property=Type=exec','--property=RuntimeMaxSec='+budget.remaining()+'ms','--property=TimeoutStopSec=60s','--property=KillMode=control-group','--property=Slice='+c.auxiliary.unit,'--property=CPUQuota='+String(c.auxiliary.cpu*100)+'%','--property=MemoryMax='+c.auxiliary.memory,'--property=MemorySwapMax=0','--property=StandardOutput=null','--property=StandardError=null','--property=BindReadOnlyPaths='+ROOT+'/hosts:/etc/hosts','--property=ExecStopPost='+process.execPath+' '+ROOT+'/proof.mjs __cleanup',process.execPath,ROOT+'/proof.mjs','__run',String(budget.end)];
}

Runtime.prototype.register=async function(name,budget){
  requireFact(this.loggingAdmitted===true,'LOG_ADMISSION');
  const endpoint='/_synapse/admin/v1/register';const {nonce}=await this.api(endpoint,{},budget);const password=crypto.randomBytes(32).toString('hex');
  const config=fs.readFileSync(`${ROOT}/secrets/homeserver.yaml`,'utf8');const secret=JSON.parse(config.match(/^registration_shared_secret: (.+)$/m)[1]);
  const mac=crypto.createHmac('sha1',secret).update([nonce,name,password,'notadmin'].join('\0')).digest('hex');
  this.events.watch(password);this.events.watch(secret);
  const result=await this.api(endpoint,{method:'POST',body:{nonce,username:name,password,admin:false,mac}},budget);
  requireFact(result.user_id===`@${name}:${serverName(this.c)}`&&typeof result.access_token==='string'&&typeof result.device_id==='string','IDENTITY');this.events.watch(result.access_token);this.secrets.push(password,secret);return result;
};
Runtime.prototype.admin=async function(method,body,budget){
  requireFact(this.loggingAdmitted===true,'LOG_ADMISSION');
  const key=fs.readFileSync(`${ROOT}/secrets/livekit.key`,'utf8'),secret=fs.readFileSync(`${ROOT}/secrets/livekit.secret`,'utf8');
  const token=jwt({iss:key,sub:'rtc-r0-verifier',nbf:Math.floor(Date.now()/1000)-1,exp:Math.floor(Date.now()/1000)+60,video:{roomAdmin:true,room:body.room}},secret);
  this.events.watch(token);
  const r=await httpRequest(`https://${this.c.domain}:${this.c.port}/twirp/livekit.RoomService/${method}`,{method:'POST',body:JSON.stringify(body),token,lookup:lookupLoopback,timeout:budget.remaining(8000),signal:budget.signal,headers:{'Content-Type':'application/json'}});budget.remaining();
  const parsed=JSON.parse(r.body);if(method==='ListParticipants'&&r.status===404&&parsed.code==='not_found')return {participants:[]};requireFact(r.status===200,'ADMIN');return parsed;
};
Runtime.prototype.openid=async function(account,budget){
  requireFact(this.loggingAdmitted===true,'LOG_ADMISSION');
  const result=await this.api(`/_matrix/client/v3/user/${encodeURIComponent(account.user_id)}/openid/request_token`,{method:'POST',token:account.access_token,body:{}},budget);
  requireFact(result.matrix_server_name===serverName(this.c)&&typeof result.access_token==='string','OPENID');this.events.watch(result.access_token);recordTtl(this.events,'openid_ttl',result.expires_in);return result;
};
Runtime.prototype.denied=async function(body,budget){
  const before=await this.admin('ListParticipants',{room:roomAlias(body.room)},budget);
  const result=await this.auth(body,budget);const observed=assertMembershipDenial(result);
  const after=await this.admin('ListParticipants',{room:roomAlias(body.room)},budget);
  assertParticipants(after.participants??[],(before.participants??[]).map(x=>x.identity));this.events.event('auth','http',observed.status,observed.errcode);
};
Runtime.prototype.freezeSyslog=function(budget,io=fs){
  budget.remaining();requireFact(!this.syslog,'HOLD');const rows=this.c.logging.bypasses.filter(row=>row.path==='/var/log/syslog');requireFact(rows.length<=1,'HOLD');if(!rows.length)return;
  const row=rows[0];requireFact(row.kind==='file','HOLD');let fd;
  try{
    const parents=['/var','/var/log'].map(name=>{const stat=io.lstatSync(name);requireFact(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===0&&(stat.mode&0o002)===0,'HOLD');return {name,stat};});
    const initial=io.lstatSync(row.path),valid=stat=>stat.isFile()&&!stat.isSymbolicLink()&&stat.dev===initial.dev&&stat.ino===initial.ino&&stat.uid===row.uid&&stat.gid===row.gid&&(stat.mode&0o777)===row.mode;
    requireFact(valid(initial)&&Number.isSafeInteger(initial.size)&&initial.size>=0,'HOLD');fd=io.openSync(row.path,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
    const check=()=>{
      for(const {name,stat} of parents){const now=io.lstatSync(name);requireFact(now.isDirectory()&&!now.isSymbolicLink()&&['dev','ino','uid','gid','mode'].every(key=>now[key]===stat[key]),'HOLD');}
      const opened=io.fstatSync(fd),named=io.lstatSync(row.path);requireFact(valid(opened)&&valid(named)&&[opened.size,named.size].every(size=>Number.isSafeInteger(size)&&size>=0)&&named.size>=opened.size,'HOLD');return {opened,named};
    };
    const state=check();requireFact(state.opened.size>=initial.size&&state.named.size>=initial.size,'HOLD');budget.remaining();this.syslog={fd,io,check,offset:initial.size};
  }catch(error){if(fd!==undefined)io.closeSync(fd);if(['DEADLINE','FAIL','UNKNOWN'].includes(error.message))throw error;throw Error('HOLD');}
};
Runtime.prototype.scanSyslog=function(budget){
  budget.remaining();const state=this.syslog;requireFact(state,'HOLD');
  try{
    const before=state.check(),end=before.opened.size;requireFact(end>=state.offset&&before.named.size>=state.offset&&end-state.offset<=1048576,'HOLD');
    const buffer=Buffer.alloc(8192);let position=state.offset;
    while(position<end){budget.remaining();const size=state.io.readSync(state.fd,buffer,0,Math.min(buffer.length,end-position),position);requireFact(size>0&&!buffer.subarray(0,size).includes(0),'HOLD');this.events.consume('verifier',buffer.subarray(0,size),'syslog');position+=size;}
    const after=state.check();requireFact(after.opened.size===end&&after.named.size===end,'HOLD');budget.remaining();this.events.check();state.offset=end;
  }catch(error){if(['DEADLINE','FAIL','UNKNOWN','LEAK'].includes(error.message))throw error;throw Error('HOLD');}
};
Runtime.prototype.closeSyslog=function(){const state=this.syslog;this.syslog=null;if(state)state.io.closeSync(state.fd);};
Runtime.prototype.scan=async function(secrets,budget){
  budget.remaining();
  for(const secret of secrets)this.events.watch(secret);
  const file=`${ROOT}/events/${this.c.runId}.jsonl`;protectedFile(file);this.events.inspectFile(file,budget);
  for(const row of this.c.logging.bypasses){
    budget.remaining();frozenMetadata(row);
    if(row.kind==='socket'){
      requireFact(['/run/systemd/journal/socket','/run/systemd/journal/stdout'].includes(row.path),'HOLD');
      const output=await command('journalctl',['--no-pager','--quiet','--output=cat','--since',this.startedAt,'--until',new Date().toISOString(),'--unit=docker.service','--unit=containerd.service','--unit=rtc-r0-'+this.c.runId+'.service'],{budget});this.events.inspectRetained('systemd-journal',Buffer.from(output),budget);
    }else if(row.path==='/var/log/syslog'&&row.kind==='file')requireFact(this.syslog,'HOLD');
    else{
      requireFact([ROOT+'/events',ROOT+'/logs'].some(root=>row.path===root||row.path.startsWith(root+'/')),'HOLD');
      const files=row.kind==='file'?[row.path]:fs.readdirSync(row.path).map(name=>path.join(row.path,name));requireFact(files.length<=128,'HOLD');
      for(const target of files)this.events.inspectFile(target,budget);
    }
    frozenMetadata(row);
  }
  requireFact(!fs.existsSync(`${ROOT}/data/homeserver.log`),'LOG_FILE');for(const i of await ownContainers(this.c,budget))requireFact(i.HostConfig.LogConfig.Type==='none','LOG_DRIVER');
  if(this.syslog)this.scanSyslog(budget);
  this.events.check();
  this.events.event('verifier','scan',0,'OK',secrets.length);
};
Runtime.prototype.sentinels=async function(budget){
  requireFact(this.loggingAdmitted===false&&this.logCases.has('connection')&&typeof this.sentinel==='string','LOG_ADMISSION');
  const sentinel=this.sentinel;
  const body={room:'!incapable:'+serverName(this.c),device_id:'incapable-device',openid_token:{access_token:sentinel,token_type:'Bearer',expires_in:1,matrix_server_name:serverName(this.c)}};
  const response=await this.auth(body,budget),parsed=JSON.parse(response.body);
  requireFact(response.status===401&&parsed.errcode==='M_UNAUTHORIZED'&&!parsed.jwt,'INCAPABLE');
  this.logCases.add('success');this.events.event('verifier','log_success',401);
  await expectFailure(httpRequest('https://'+serverName(this.c)+'/_matrix/client/versions',{token:sentinel,servername:this.c.domain,expectedHostname:'incapable.invalid',lookup:lookupLoopback,timeout:budget.remaining(8000),signal:budget.signal}),'TLS',budget);this.logCases.add('tls');this.events.event('verifier','log_tls');
  const upgrade=await httpRequest('https://'+serverName(this.c)+'/rtc',{token:sentinel,lookup:lookupLoopback,timeout:budget.remaining(8000),signal:budget.signal,headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':crypto.randomBytes(16).toString('base64')}});budget.remaining();requireFact(upgrade.status===401,'LOG_ADMISSION');this.logCases.add('handshake');this.events.event('verifier','log_handshake',401);
  const receipt=readOwnership(this.c);requireFact(receipt.host===this.c.host&&receipt.project===this.c.project&&receipt.runId===this.c.runId&&receipt.machineUuid===this.c.machineUuid,'UNKNOWN');const row=receipt.containers.find(item=>item.service==='synapse');requireFact(row,'UNKNOWN');
  const owned=async current=>{const item=await inspect(row.id,current);assertOwned(item,this.c,'synapse');requireFact(item.Id===row.id&&item.Image===row.imageId&&item.Created===row.created&&item.State.Running,'UNKNOWN');return item;};
  requireFact(!(await owned(budget)).State.Paused,'BUSY');
  try{
    await command('docker',['pause',row.id],{budget});requireFact((await owned(budget)).State.Paused,'UNKNOWN');
    // This proves the verifier's client deadline, not auth's internal 30 s timer.
    await expectFailure(this.auth(body,budget),'DEADLINE',budget);
  }finally{
    let restore=budget;try{restore.remaining();}catch{restore=this.cleanup??=cleanupBudget(this.c);}
    if((await owned(restore)).State.Paused){await command('docker',['unpause',row.id],{budget:restore});requireFact(!(await owned(restore)).State.Paused,'UNKNOWN');}
  }
  const restored=await this.auth(body,budget),restoredBody=JSON.parse(restored.body);requireFact(restored.status===401&&restoredBody.errcode==='M_UNAUTHORIZED'&&!restoredBody.jwt,'LOG_ADMISSION');this.logCases.add('timeout');this.events.event('verifier','log_timeout');
  await this.audit(budget);await this.scan([sentinel,...this.secrets],budget);
  requireFact(['connection','success','tls','handshake','timeout'].every(name=>this.logCases.has(name)),'LOG_ADMISSION');this.events.check();budget.remaining();this.loggingAdmitted=true;this.events.event('verifier','gate',401,'OK',5);
};
async function expectFailure(work,expected,budget){let observed;try{await work;}catch(error){observed=error.message;}budget.remaining();requireFact(observed===expected,'LOG_ADMISSION');}
Runtime.prototype.verify=async function(budget){
  requireFact(this.loggingAdmitted===true,'LOG_ADMISSION');
  await this.audit(budget);const secrets=this.secrets;const sockets=[];
  try{
    const a=await this.register('rtc-a',budget),b=await this.register('rtc-b',budget),outsider=await this.register('rtc-outsider',budget);
    secrets.push(a.access_token,b.access_token,outsider.access_token);
    const room=(await this.api('/_matrix/client/v3/createRoom',{method:'POST',token:a.access_token,body:{preset:'private_chat',visibility:'private',creation_content:{'m.federate':false}}},budget)).room_id;
    const other=(await this.api('/_matrix/client/v3/createRoom',{method:'POST',token:outsider.access_token,body:{preset:'private_chat',visibility:'private',creation_content:{'m.federate':false}}},budget)).room_id;
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
      const r=await this.auth(request(account,openid),budget);requireFact(r.status===200,'SFU');const ticket=JSON.parse(r.body);requireFact(ticket.url===`wss://${this.c.domain}:${this.c.port}`,'SFU_URL');this.events.watch(ticket.jwt);secrets.push(ticket.jwt);
      const subject=`${account.user_id}:${account.device_id}`,claims=decodeTicket(ticket.jwt,secret);assertTicket(claims,{subject,room:roomAlias(room),key});recordTtl(this.events,'jwt_remaining',Math.floor(claims.exp-Date.now()/1000));expected.push(subject);
      const connection=await signal(ticket.url,ticket.jwt,{identity:subject,room:roomAlias(room),timeout:budget.remaining(8000),abortSignal:budget.signal});this.connections.push(connection);sockets.push(connection.socket);budget.remaining();
      const participants=await this.admin('ListParticipants',{room:roomAlias(room)},budget);assertParticipants(participants.participants??[],expected);
    }
    const wrong=await httpRequest(`https://${this.c.domain}:${this.c.port}/get_token`,{method:'POST',lookup:lookupLoopback,timeout:budget.remaining(8000),signal:budget.signal,body:JSON.stringify({room_id:room,slot_id:'m.call#ROOM',openid_token:tokenA,member:{id:'wrong-subject',claimed_user_id:outsider.user_id,claimed_device_id:a.device_id}}),headers:{'Content-Type':'application/json'}});budget.remaining();
    const wrongBody=JSON.parse(wrong.body);requireFact(wrong.status===401&&wrongBody.errcode==='M_UNAUTHORIZED'&&!wrongBody.jwt,'WRONG_SUBJECT');this.events.event('auth','http',wrong.status,wrongBody.errcode);
    assertParticipants((await this.admin('ListParticipants',{room:roomAlias(room)},budget)).participants??[],expected);
    await this.api(`/_matrix/client/v3/rooms/${encoded}/kick`,{method:'POST',body:{user_id:b.user_id},token:a.access_token},budget);const fresh=await this.openid(b,budget);secrets.push(fresh.access_token);await this.denied(request(b,fresh),budget);
    // Existing participants and old JWT remain separate upstream behavior. Remove
    // both own participants explicitly; do not claim kick revokes established RTC.
    await retireParticipants(this.connections,expected,identity=>this.admin('RemoveParticipant',{room:roomAlias(room),identity},budget),async()=>(await this.admin('ListParticipants',{room:roomAlias(room)},budget)).participants??[]);
    for(const account of [a,b,outsider]){await this.api('/_matrix/client/v3/logout',{method:'POST',body:{},token:account.access_token},budget);const revoked=await this.api('/_matrix/client/v3/account/whoami',{token:account.access_token,expected:401},budget);requireFact(revoked.errcode==='M_UNKNOWN_TOKEN','LOGOUT');}
    await this.audit(budget);await this.scan(secrets,budget);this.events.event('verifier','participants',200,'OK',2);
  }finally{for(const socket of sockets)socket.close();}
};

function unitState(text){return Object.fromEntries(text.trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];}));}
function workerGroup(c){
  const group=c.auxiliary.cgroup+'/rtc-r0-'+c.runId+'.service';
  if(!fs.existsSync(group))return null;
  const stat=fs.lstatSync(group);requireFact(stat.isDirectory()&&!stat.isSymbolicLink(),'UNKNOWN');return fs.readFileSync(group+'/cgroup.events','utf8');
}
function assertWorkerGroup(c,budget,readGroup){budget.remaining();const state=readGroup(c);requireFact(state===null||typeof state==='string'&&/^populated 0$/m.test(state),'UNKNOWN');budget.remaining();}
export async function stopUnit(c,budget,run=command,readGroup=workerGroup){
  const unit='rtc-r0-'+c.runId+'.service';
  const state=unitState(await run('systemctl',['show',unit,'--property=Description,Slice,Transient,LoadState,ActiveState,MainPID,ControlPID,Job,ControlGroup'],{budget}));
  budget.remaining();
  if(state.LoadState==='not-found'){
    assertUnitStopped(state);requireFact(state.Job===''&&state.ControlGroup==='','UNKNOWN');assertWorkerGroup(c,budget,readGroup);return;
  }
  requireFact(state.LoadState==='loaded'&&state.Description==='BabaCom RTC '+c.runId&&state.Slice===c.auxiliary.unit&&state.Transient==='yes','UNKNOWN');
  await run('systemctl',['stop',unit],{budget,timeout:budget.remaining(60000)});
}
export function assertUnitStopped(state){requireFact(['inactive','failed'].includes(state.ActiveState)&&state.MainPID==='0'&&state.ControlPID==='0'&&(state.Job===undefined||state.Job===''),'UNKNOWN');}
export async function unitStopped(c,budget,run=command,readGroup=workerGroup){
  const state=unitState(await run('systemctl',['show','rtc-r0-'+c.runId+'.service','--property=Description,Slice,Transient,LoadState,ActiveState,MainPID,ControlPID,Job,ControlGroup'],{budget}));
  assertUnitStopped(state);requireFact(['loaded','not-found'].includes(state.LoadState)&&state.Job==='','UNKNOWN');
  if(state.LoadState==='not-found')requireFact(state.ControlGroup==='','UNKNOWN');
  else requireFact(state.Description==='BabaCom RTC '+c.runId&&state.Slice===c.auxiliary.unit&&state.Transient==='yes'&&['',c.auxiliary.cgroup.slice('/sys/fs/cgroup'.length)+'/rtc-r0-'+c.runId+'.service'].includes(state.ControlGroup),'UNKNOWN');
  assertWorkerGroup(c,budget,readGroup);
}
async function runTask(c,budget){
  const runtime=new Runtime(c,budget);let requested=false,ready=false;
  process.once('SIGUSR1',()=>{if(ready)requested=true;});
  try{
    await runtime.start(budget);writeState(c,'READY',budget.end);ready=true;
    while(!requested){await runtime.audit(budget);await new Promise(r=>setTimeout(r,budget.remaining(250)));}
    writeState(c,'VERIFYING',budget.end);await runtime.verify(budget);await runtime.stop();runtime.events.event('verifier','gate',200,'OK',0);writeState(c,'VERIFIED',budget.end);
  }catch(error){try{runtime.recordFailure(error);}catch{}await runtime.stop().catch(()=>{});writeState(c,'FAIL',budget.end);throw new Error('FAIL');}
  finally{if(runtime.monitor&&!runtime.monitor.closed&&runtime.cleanup)await runtime.monitor.close(runtime.cleanup);}
  // systemd ExecStopPost also runs after SIGKILL, timeout and synchronous failure.
}
export async function main(action){
  requireFact(['preflight','config','up','verify','stop','__run','__cleanup'].includes(action),'COMMAND');
  const c=readContract(action);
  if(action==='stop'||action==='__cleanup')return cleanupHook(c,runtimeEvents(c),{stopWorker:action==='stop'});
  let budget=action==='__run'?Budget.fromDeadline(Number(process.argv[3])):new Budget(120000);ownAux(c);
  if(action==='preflight')await preflight(c,budget);
  else if(action==='config')await configure(c,budget);
  else if(action==='__run')await runTask(c,budget);
  else if(action==='up'){
    await startExperiment(c,budget,{
      preflight:async()=>{await preflight(c,budget);validateGenerated(c);requireFact(!fs.existsSync(ownershipPath(c))&&!fs.existsSync(statePath(c)),'BUSY');requireFact((await ownContainers(c,budget)).length===0,'BUSY');},
      launch:()=>command('systemd-run',systemdArguments(c,budget),{budget}),
      status:async()=>{if(!fs.existsSync(statePath(c)))return{status:'BUSY'};const state=readState(c);requireFact(state.phase!=='FAIL','FAIL');return{status:state.phase==='READY'?'OK':'BUSY'};},
      recover:()=>stopUnit(c,cleanupBudget(c))
    });
  }else if(action==='verify'){
    const before=readState(c);requireFact(before.phase==='READY','BUSY');budget=Budget.fromDeadline(before.deadline);
    fs.writeFileSync(ROOT+'/verify-'+c.runId+'.requested','requested\n',{flag:'wx',mode:0o400});
    await command('systemctl',['kill','--kill-whom=main','--signal=USR1','rtc-r0-'+c.runId+'.service'],{budget});
    try{while(true){budget.remaining();const state=readState(c);requireFact(state.phase!=='FAIL','FAIL');if(state.phase==='VERIFIED')break;await new Promise(r=>setTimeout(r,budget.remaining(25)));}}
    catch(error){await stopUnit(c,cleanupBudget(c));throw error;}
    await stopUnit(c,cleanupBudget(c));await unitStopped(c,cleanupBudget(c));
  }
}
export async function publicCommand(action,run=main){
  try{await run(action);process.stdout.write('{"service":"verifier","event":"command","errcode":"OK"}\n');return 0;}
  catch(error){const errcode=['UNKNOWN','BUSY','DEADLINE','FAIL','HOLD'].includes(error?.message)?error.message:'HOLD';process.stderr.write(JSON.stringify({service:'verifier',event:'command',errcode})+'\n');return 1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await publicCommand(process.argv[2]);
