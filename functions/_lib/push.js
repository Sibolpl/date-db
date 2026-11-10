// Web Push: RFC 8291 aes128gcm + RFC 8292 VAPID, Cloudflare WebCrypto.
const te = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const from64 = value => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)), c=>c.charCodeAt(0));
const concat = (...chunks) => {const out=new Uint8Array(chunks.reduce((n,a)=>n+a.length,0));let i=0;for(const c of chunks){out.set(c,i);i+=c.length;}return out;};
const u16 = n => new Uint8Array([n>>8,n&255]);
async function hkdf(ikm,salt,info,len) {const k=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},k,len*8));}
async function encrypted(payload,sub) {
  const clientPublic=from64(sub.keys.p256dh), auth=from64(sub.keys.auth);
  const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const receiver=await crypto.subtle.importKey('raw',clientPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:receiver},ephemeral.privateKey,256));
  const serverPublic=new Uint8Array(await crypto.subtle.exportKey('raw',ephemeral.publicKey));
  const ikm=await hkdf(shared,auth,concat(te.encode('WebPush: info\0'),clientPublic,serverPublic),32);
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const cek=await hkdf(ikm,salt,te.encode('Content-Encoding: aes128gcm\0'),16);
  const nonce=await hkdf(ikm,salt,te.encode('Content-Encoding: nonce\0'),12);
  const aes=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']);
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},aes,concat(te.encode(JSON.stringify(payload)),new Uint8Array([2]))));
  const recordSize=4096;
  const header=concat(salt,new Uint8Array([recordSize>>>24,(recordSize>>>16)&255,(recordSize>>>8)&255,recordSize&255]),new Uint8Array([serverPublic.length]),serverPublic);
  return concat(header,cipher);
}
async function vapid(endpoint,privateKey,publicKey,subject) {
  const origin=new URL(endpoint).origin;
  const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',d:b64url(from64(privateKey)),x:b64url(from64(publicKey).slice(1,33)),y:b64url(from64(publicKey).slice(33,65)),ext:true},{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const head=b64url(te.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const body=b64url(te.encode(JSON.stringify({aud:origin,exp:Math.floor(Date.now()/1000)+3600,sub:subject||'mailto:admin@example.com'})));
  const input=`${head}.${body}`;
  const sig=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,te.encode(input)));
  return `${input}.${b64url(sig)}`;
}
export async function sendPush(env,sub,payload) {
  if(!env.VAPID_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY)throw Error('Brak kluczy VAPID');
  const endpoint=new URL(sub.endpoint);
  if(endpoint.protocol!=='https:' || !['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','*.push.apple.com'].some(h=>h.startsWith('*.')?endpoint.hostname.endsWith(h.slice(1)):endpoint.hostname===h))throw Error('Nieobsługiwany serwer push');
  const token=await vapid(sub.endpoint,env.VAPID_PRIVATE_KEY,env.VAPID_PUBLIC_KEY,env.VAPID_SUBJECT);
  const data=await encrypted(payload,sub);
  const response=await fetch(sub.endpoint,{method:'POST',headers:{'TTL':'86400','Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream','Authorization':`vapid t=${token}, k=${env.VAPID_PUBLIC_KEY}`},body:data});
  return response.status;
}
export async function notifyOwners(env,profileIds,payload) {
  if(!env.VAPID_PRIVATE_KEY||!env.VAPID_PUBLIC_KEY)return;
  const ids=[...new Set(profileIds)].filter(Boolean);if(!ids.length)return;
  const marks=ids.map(()=>'?').join(',');
  const {results}=await env.DB.prepare(`SELECT DISTINCT s.endpoint,s.p256dh,s.auth FROM push_subscriptions s JOIN owner_users u ON u.id=s.user_id AND u.active=1 JOIN owner_permissions op ON op.user_id=u.id AND op.can_view=1 WHERE op.profile_id IN (${marks})`).bind(...ids).all();
  await Promise.allSettled((results||[]).map(async r=>{
    try {const status=await sendPush(env,{endpoint:r.endpoint,keys:{p256dh:r.p256dh,auth:r.auth}},payload);if(status===404||status===410)await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').bind(r.endpoint).run();else if(status<200||status>=300)console.error('Push HTTP',status);}catch(e){console.error('Push failed',e.message);}
  }));
}
