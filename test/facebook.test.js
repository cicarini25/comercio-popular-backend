import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { verifyFacebook, createFacebookRouter } from '../src/routes/facebook.js';
const env = { FACEBOOK_APP_ID: '123', FACEBOOK_APP_SECRET: 'test-secret', JWT_SECRET: 'test-jwt-secret' };
const valid = { is_valid: true, app_id: '123', user_id: 'fb1', type: 'USER', expires_at: Date.now()/1000 + 3600 };
for (const [name, change] of [['app errado',{app_id:'999'}],['expirado',{expires_at:1}],['revogado',{is_valid:false}],['tipo errado',{type:'PAGE'}],['dados expirados',{data_access_expires_at:1}]]) {
  test(`rejeita token ${name}`, async () => {
    let calls = 0;
    await assert.rejects(verifyFacebook('test-token',env,async()=> { calls++; return {ok:true,json:async()=>({data:{...valid,...change}})}; }), {status:401});
    assert.equal(calls,1);
  });
}
test('confere identidade e envia prova assinada para /me', async () => {
  const calls=[];
  const p = await verifyFacebook('test-token',env,async(url,options)=> {
    calls.push({url,options}); return {ok:true,json:async()=> calls.length===1 ? {data:valid} : {id:'fb1',name:'Teste',email:'test@example.test'}};
  });
  assert.equal(p.id,'fb1'); assert.equal(calls[1].url.searchParams.get('appsecret_proof').length,64);
  assert.equal(calls[1].options.headers.Authorization,'Bearer test-token');
});
test('rejeita /me divergente', async()=> {
  let n=0;
  await assert.rejects(verifyFacebook('test-token',env,async()=>({ok:true,json:async()=> ++n===1 ? {data:valid} : {id:'other'}})),{status:401});
});
const baseUser={id:'user-1',name:'Teste',email:'test@example.test',legal_accepted_at:'2026-09-20T00:00:00.000Z',legal_version:'1'};
async function request(body,{linked,existing,profile={id:'fb1',name:'Teste',email:'test@example.test'}}={}) {
  const queries=[];
  const client={ release(){}, async query(sql,args){
    queries.push({sql,args});
    if(sql.includes('JOIN facebook_identities')) return {rows:linked?[linked]:[]};
    if(sql.includes('lower(email)')) return {rows:existing?[existing]:[]};
    if(sql.startsWith('INSERT INTO users')) return {rows:[{...baseUser,legal_accepted_at:null,legal_version:null}]};
    return {rows:[]};
  }};
  const app=express(); app.use(express.json()); app.use('/facebook',createFacebookRouter({env,db:{connect:async()=>client},verify:async()=>profile}));
  const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.on('listening',r));
  try { const res=await fetch(`http://127.0.0.1:${server.address().port}/facebook`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); return {status:res.status,data:await res.json(),queries}; }
  finally { await new Promise(r=>server.close(r)); }
}
test('novo perfil incompleto não cria usuário nem sessão',async()=>{
  const r=await request({accessToken:'test'}); assert.equal(r.data.status,'registration_required'); assert.equal(r.data.token,undefined); assert.ok(!r.queries.some(q=>q.sql.startsWith('INSERT')));
});
test('e-mail existente exige vinculação explícita',async()=>{
  const r=await request({accessToken:'test'},{existing:baseUser}); assert.equal(r.data.status,'link_required'); assert.equal(r.data.token,undefined);
});
test('senha incorreta nunca vincula',async()=>{
  const r=await request({accessToken:'test',action:'link',password:'wrong-password'},{existing:{...baseUser,password_hash:await bcrypt.hash('correct-password',4)}});
  assert.equal(r.status,401); assert.ok(!r.queries.some(q=>q.sql.startsWith('INSERT')));
});
test('conta Google sem senha mantém seu método original',async()=>{
  const r=await request({accessToken:'test',action:'link',password:'any-password'},{existing:baseUser}); assert.equal(r.status,409);
});
test('senha correta vincula e emite sessão sem expor hash',async()=>{
  const r=await request({accessToken:'test',action:'link',password:'correct-password'},{existing:{...baseUser,password_hash:await bcrypt.hash('correct-password',4)}});
  assert.equal(r.status,200); assert.equal(jwt.verify(r.data.token,env.JWT_SECRET).userId,'user-1'); assert.equal(r.data.user.password_hash,undefined); assert.ok(r.queries.some(q=>q.sql.startsWith('INSERT INTO facebook_identities')));
});
test('cadastro valida CPF antes de inserir',async()=>{
  const r=await request({accessToken:'test',action:'register',password:'test-password',cpf:'11111111111',phone:'41999999999'}); assert.equal(r.status,400); assert.ok(!r.queries.some(q=>q.sql.startsWith('INSERT')));
});
test('cadastro completo grava usuário e identidade na mesma transação',async()=>{
  const r=await request({accessToken:'test',action:'register',password:'test-password',cpf:'52998224725',phone:'41999999999'}); assert.equal(r.status,200); assert.ok(r.queries.some(q=>q.sql==='COMMIT')); assert.equal(r.queries.filter(q=>q.sql.startsWith('INSERT')).length,2);
});
test('perfil sem e-mail não cria cadastro',async()=>{
  const r=await request({accessToken:'test'},{profile:{id:'fb1',name:'Teste'}}); assert.equal(r.status,400);
});
test('identidade já vinculada entra mesmo sem e-mail no retorno da Meta',async()=>{
  const r=await request({accessToken:'test'},{linked:baseUser,profile:{id:'fb1'}}); assert.equal(r.data.status,'authenticated');
});
