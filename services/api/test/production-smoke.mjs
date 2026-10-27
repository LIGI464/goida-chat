/* global process, console, fetch, URL, FormData, Blob, setTimeout, clearTimeout */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { io } from 'socket.io-client';

const origin = process.env.RELEASE_SMOKE_ORIGIN;
const revision = process.env.RELEASE_SMOKE_SHA;
const output = process.env.RELEASE_SMOKE_MANIFEST;
if (origin !== 'https://app.goida-chat.ru' || !revision?.match(/^[a-f0-9]{40}$/) || !output)
  throw new Error('Explicit production origin, exact SHA and private fixture manifest are required');
const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
const manifest = { suffix, users: [], chats: [], attachments: [], checks: [] };
const sockets = [];
const pass = (name) => { manifest.checks.push(name); console.log(`PASS ${name}`); };
const actor = () => ({ cookie: '' });
async function request(who, path, method = 'GET', body) {
  const multipart = body instanceof FormData;
  const response = await fetch(origin + path, {
    method, headers: { Origin: origin, ...(who.cookie ? { Cookie: who.cookie } : {}),
      ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
  });
  const cookies = new Map(who.cookie.split('; ').filter(Boolean).map((item) => [item.slice(0,item.indexOf('=')),item.slice(item.indexOf('=')+1)]));
  for (const header of response.headers.getSetCookie()) {
    const pair=header.split(';')[0]; cookies.set(pair.slice(0,pair.indexOf('=')),pair.slice(pair.indexOf('=')+1));
  }
  who.cookie=[...cookies].map(([name,value])=>`${name}=${value}`).join('; ');
  return response;
}
async function ok(who, path, method, body, status=200) {
  const response=await request(who,path,method,body);
  assert.equal(response.status,status,`${method??'GET'} ${path.replace(/\/invites\/[^/]+/,'/invites/[redacted]')} returned ${response.status}`);
  return response.json();
}
async function socket(who) {
  const client=io(origin,{transports:['websocket'],extraHeaders:{Cookie:who.cookie},reconnection:false});
  sockets.push(client);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Socket connection timeout')),10000);client.once('connect',()=>{clearTimeout(timer);resolve()});client.once('connect_error',reject)});
  return client;
}
async function ack(client,event,payload) { return new Promise((resolve,reject)=>client.timeout(10000).emit(event,payload,(error,value)=>error?reject(error):resolve(value))); }
try {
  assert.equal((await ok(actor(),'/health')).revision,revision);
  const version=await fetch(origin+'/version.json',{cache:'no-store'}); assert.equal((await version.json()).revision,revision);
  assert.equal((await fetch(origin+'/app')).status,200);
  pass('HTTPS frontend/backend and exact deployed revisions');
  const owner=actor(),peer=actor(),guest=actor(),outsider=actor();
  for (const [label,who] of [['owner',owner],['peer',peer]]) {
    who.username=`rel_${label}_${suffix}`;
    const result=await ok(who,'/auth/sign-up/email','POST',{email:`${who.username}@example.test`,username:who.username,name:'Release smoke',password:`Release!${suffix}Password`});
    who.id=result.user.id;manifest.users.push({id:who.id,username:who.username});
    assert.equal((await ok(who,'/auth/me')).kind,'user');
  }
  const chat=(await ok(owner,'/chats/group','POST',{title:`Release smoke ${suffix}`,memberUsernames:[]})).chat;manifest.chats.push(chat.id);
  const invite=await ok(owner,`/chats/${chat.id}/invites`,'POST',{maxUses:4});
  await ok(peer,`/invites/${invite.token}/join`,'POST');
  await ok(guest,'/auth/guest/start','POST',{token:invite.token});
  assert.deepEqual((await ok(guest,'/chats')).chats.map((c)=>c.id),[chat.id]);
  assert.equal((await request(outsider,`/chats/${chat.id}`)).status,401);
  pass('synthetic registration, invitation, member join and scoped guest entry');
  const a=await socket(owner),b=await socket(peer);
  assert.equal((await ack(a,'chat:join',{chatId:chat.id})).ok,true);
  assert.equal((await ack(b,'chat:join',{chatId:chat.id})).ok,true);
  const message=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Realtime message timeout')),10000);b.once('message:new',(value)=>{clearTimeout(timer);resolve(value)})});
  assert.equal((await ack(a,'message:send',{chatId:chat.id,text:'Synthetic production validation'})).ok,true);
  assert.equal((await message).chatId,chat.id);
  const token=await ok(guest,`/chats/${chat.id}/voice/token`,'POST');assert.ok(token.token&&token.url.startsWith('wss://'));
  pass('production Socket.IO realtime and scoped LiveKit token issuance');
  const form=new FormData();form.append('text','Synthetic fixture, safe to remove');form.append('file',new Blob(['goida release storage persistence fixture'],{type:'text/plain'}),'release-smoke.txt');
  const uploaded=await ok(guest,`/chats/${chat.id}/attachments`,'POST',form,201);
  const attachment=uploaded.message.attachments[0];manifest.attachments.push(attachment.id);
  const link=await ok(guest,`/chats/${chat.id}/attachments/${attachment.id}/url`);
  const content=await request(guest,new URL(link.url,origin).pathname+new URL(link.url,origin).search);
  assert.equal(content.status,200);assert.equal(await content.text(),'goida release storage persistence fixture');
  assert.equal(content.headers.get('x-content-type-options'),'nosniff');
  assert.ok(content.headers.get('content-security-policy')?.includes('sandbox'));
  const forbidden=await request(outsider,new URL(link.url,origin).pathname+new URL(link.url,origin).search);assert.equal(forbidden.status,401);
  pass('guest upload, protected download and non-executable content headers');
  await ok(guest,'/auth/guest/sign-out','POST');assert.equal((await request(guest,`/chats/${chat.id}`)).status,401);
  await ok(peer,'/auth/sign-out','POST');assert.equal((await request(peer,'/auth/me')).status,401);
  pass('guest/account logout revoke HTTP access');
} finally {
  for (const client of sockets) client.disconnect();
  await writeFile(output,JSON.stringify(manifest,null,2),{mode:0o600});
}
