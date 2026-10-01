import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeFeedItems, importShopeeFeed } from '../src/integrations/shopee/feed-importer.js';
const fixture = JSON.parse(fs.readFileSync(new URL('../examples/shopee-preview.json', import.meta.url)));

test('CSV real: preços, IDs e links preservados; prévia não conecta ao banco', async () => {
  const result = await importShopeeFeed(fixture, { connect() { throw Error('não conectar'); } });
  assert.equal(result.count, 2);
  assert.equal(result.products[0].price, 569.9);
  assert.equal(result.products[0].affiliateUrl, 'https://s.shopee.com.br/6AlS6msWUl');
});
test('rejeita link genérico, domínio semelhante, ID incorreto, preço zero e duplicatas', () => {
  for (const patch of [
    { affiliateUrl: 'https://shope.ee/an_redir?origin_link=x' },
    { affiliateUrl: 'https://s.shopee.com.br.evil.test/link' },
    { affiliateUrl: 'https://s.shopee.com.br/' },
    { itemid: '999' }, { sale_price: '0' }, { price: 'NaN' }
  ]) assert.throws(() => normalizeFeedItems([{ ...fixture.items[0], ...patch }]));
  assert.throws(() => normalizeFeedItems([fixture.items[0],fixture.items[0]]));
});
test('transação: reimportação atualiza oferta e falha desfaz operação', async () => {
  for (const fail of [false, true]) {
    const calls = []; let released = false;
    const client = { async query(sql, args) {
      calls.push(sql);
      if (sql.includes('SELECT id FROM affiliate_platforms')) return { rows: [{id:'platform'}] };
      if (sql.startsWith('SELECT id, product_id')) return { rows: [{id:'offer',product_id:'product'}] };
      if (sql.includes('INSERT INTO product_offers')) {
        if (fail) throw Error('DB failure');
        assert.equal(args[4], fixture.items[0].affiliateUrl);
        return { rows: [{id:'offer'}] };
      }
      return {rows:[]};
    }, release() { released=true; } };
    const run = importShopeeFeed({items:[fixture.items[0]],dryRun:false}, {async connect(){return client;}});
    if (fail) await assert.rejects(run, /DB failure/);
    else { const result=await run; assert.equal(result.offers[0].action,'updated'); }
    assert.equal(calls.at(-1), fail ? 'ROLLBACK' : 'COMMIT');
    assert.ok(released);
    assert.ok(!calls.some(sql=>sql.includes('INSERT INTO products')));
  }
});

test('rotas: exige administrador, prévia sem banco e redirect usa oferta armazenada', async () => {
  const { default: express } = await import('express');
  const { default: integrations } = await import('../src/routes/integrations.js');
  const { default: catalog } = await import('../src/routes/catalog.js');
  const { default: pool } = await import('../src/db/pool.js');
  const oldToken=process.env.INTEGRATION_ADMIN_TOKEN, oldQuery=pool.query;
  process.env.INTEGRATION_ADMIN_TOKEN='test-only-token';
  const app=express();app.use(express.json());app.use('/integrations',integrations);app.use('/catalog',catalog);
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    let response=await fetch(base+'/integrations/shopee/import-feed',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(fixture)});
    assert.equal(response.status,401);
    response=await fetch(base+'/integrations/shopee/import-feed',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test-only-token'},body:JSON.stringify(fixture)});
    assert.equal(response.status,200);assert.equal((await response.json()).count,2);
    pool.query=async()=>({rows:[{affiliate_url:fixture.items[0].affiliateUrl}]});
    const path='/catalog/offers/11111111-1111-1111-1111-111111111111/go';
    response=await fetch(base+path,{redirect:'manual'});
    assert.equal(response.status,302);assert.equal(response.headers.get('location'),fixture.items[0].affiliateUrl);
    pool.query=async()=>({rows:[]});
    assert.equal((await fetch(base+path,{redirect:'manual'})).status,404);
    pool.query=async()=>({rows:[{affiliate_url:'https://evil.test/'}]});
    assert.equal((await fetch(base+path,{redirect:'manual'})).status,503);
  } finally {
    pool.query=oldQuery;
    if(oldToken===undefined)delete process.env.INTEGRATION_ADMIN_TOKEN;else process.env.INTEGRATION_ADMIN_TOKEN=oldToken;
    await new Promise(resolve=>server.close(resolve));
  }
});
