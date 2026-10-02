import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import pool from '../db/pool.js';

const router = express.Router();
const IMAGE_DIR = '/data/shopee-images';
const IMAGE_IDS = ["20199713818","22998831150","23097363814","24898136951","27209244452","41619217982","44518001780","44566118916","45106201159","45313071694","49962261791","51661234810","53267687943","58010381012","58200883581","58217594272","58217601055","58259210927","58262438231","58266849757"];

function requireIntegrationAdmin(req, res, next) {
  const configured = process.env.INTEGRATION_ADMIN_TOKEN?.trim();
  const authorization = req.headers.authorization ?? '';
  const provided = authorization.startsWith('Bearer ')
    ? authorization.slice(7).trim()
    : req.headers['x-integration-token'];

  if (!configured) {
    return res.status(503).json({
      error: 'Integrações administrativas não configuradas. Defina INTEGRATION_ADMIN_TOKEN.'
    });
  }
  if (!provided || provided !== configured) {
    return res.status(401).json({ error: 'Credencial de integração inválida.' });
  }
  next();
}

async function ensureImageDir() {
  await fs.mkdir(IMAGE_DIR, { recursive: true });
}

function imagePath(itemId) {
  if (!IMAGE_IDS.includes(itemId)) throw new Error('Item ID não autorizado para restauração.');
  return path.join(IMAGE_DIR, itemId + '.jpg');
}

router.get('/ui', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Restauração de imagens Shopee</title>
<style>
body{font-family:Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:24px}
main{max-width:900px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px}
h1{margin-top:0}.muted{color:#64748b}
input,button{font:inherit}.token{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;margin:8px 0 16px}
button{padding:12px 16px;border:0;border-radius:10px;cursor:pointer;background:#ea580c;color:white;font-weight:700;margin-right:8px}
button.secondary{background:#0f766e}.status{margin-top:16px;padding:12px;border-radius:10px;background:#f1f5f9;white-space:pre-wrap}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:16px}
.item{border:1px solid #e2e8f0;border-radius:10px;padding:10px}.ok{color:#047857}.missing{color:#b91c1c}
small{display:block;margin-top:4px;color:#64748b}
</style>
</head>
<body>
<main>
<h1>Restauração das 20 imagens Shopee</h1>
<p class="muted">Extraia o ZIP das 20 imagens e selecione os arquivos JPG. O sistema grava somente as imagens no volume persistente e, ao finalizar, atualiza somente <code>products.image_url</code>.</p>
<label>Token administrativo<input id="token" class="token" type="password" autocomplete="off"></label>
<input id="files" type="file" accept=".jpg,.jpeg,image/jpeg" multiple>
<div style="margin-top:16px">
<button id="upload">Enviar imagens</button>
<button id="finalize" class="secondary">Aplicar restauração no catálogo</button>
</div>
<div id="status" class="status">Pronto.</div>
<div id="list" class="grid"></div>
</main>
<script>
const ids=["20199713818","22998831150","23097363814","24898136951","27209244452","41619217982","44518001780","44566118916","45106201159","45313071694","49962261791","51661234810","53267687943","58010381012","58200883581","58217594272","58217601055","58259210927","58262438231","58266849757"];
const statusEl=document.getElementById('status');
const listEl=document.getElementById('list');
const tokenEl=document.getElementById('token');
function auth(){return {Authorization:'Bearer '+tokenEl.value.trim()};}
function show(msg){statusEl.textContent=msg;}
function renderState(data){
  listEl.innerHTML=ids.map(id=>{
    const ok=data.uploaded.includes(id);
    return '<div class="item"><strong>'+id+'</strong><small class="'+(ok?'ok':'missing')+'">'+(ok?'Imagem recebida':'Aguardando imagem')+'</small></div>';
  }).join('');
}
async function refresh(){
  const r=await fetch('/api/integrations/shopee-images/status');
  const data=await r.json();
  if(!r.ok) throw new Error(data.error||'Falha ao consultar status.');
  renderState(data);
  return data;
}
document.getElementById('upload').onclick=async()=>{
  try{
    const files=[...document.getElementById('files').files];
    if(!tokenEl.value.trim()) throw new Error('Informe o token administrativo.');
    if(!files.length) throw new Error('Selecione os 20 arquivos JPG.');
    let done=0;
    for(const file of files){
      const match=file.name.match(/(\\d+)\\.jpe?g$/i);
      const itemId=match?.[1];
      if(!itemId || !ids.includes(itemId)) continue;
      const r=await fetch('/api/integrations/shopee-images/upload/'+itemId,{
        method:'POST',
        headers:{...auth(),'Content-Type':'image/jpeg'},
        body:file
      });
      const data=await r.json();
      if(!r.ok) throw new Error(data.error||('Falha no Item '+itemId));
      done++;
      show('Enviadas '+done+' imagens...');
    }
    await refresh();
    show('Upload concluído. Confira os 20 itens e clique em "Aplicar restauração no catálogo".');
  }catch(e){show(e instanceof Error?e.message:'Falha no upload.');}
};
document.getElementById('finalize').onclick=async()=>{
  try{
    if(!tokenEl.value.trim()) throw new Error('Informe o token administrativo.');
    const state=await refresh();
    if(state.uploaded.length!==ids.length) throw new Error('Ainda faltam imagens. Envie os 20 arquivos antes de finalizar.');
    if(!confirm('Aplicar as 20 imagens no catálogo? Somente products.image_url será atualizado.')) return;
    const r=await fetch('/api/integrations/shopee-images/finalize',{method:'POST',headers:auth()});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error||'Falha na restauração.');
    show('Restauração concluída: '+data.updated+' imagens atualizadas. Nenhum outro campo foi alterado.');
    await refresh();
  }catch(e){show(e instanceof Error?e.message:'Falha na restauração.');}
};
refresh().catch(e=>show(e.message));
</script>
</body></html>`);
});

router.get('/status', async (_req, res) => {
  try {
    await ensureImageDir();
    const entries = await fs.readdir(IMAGE_DIR);
    const uploaded = IMAGE_IDS.filter(id => entries.includes(id + '.jpg'));
    return res.json({
      ok: true,
      total: IMAGE_IDS.length,
      uploaded,
      missing: IMAGE_IDS.filter(id => !uploaded.includes(id))
    });
  } catch (error) {
    console.error('Erro ao consultar imagens Shopee:', error);
    return res.status(500).json({ error: 'Não foi possível consultar o armazenamento das imagens.' });
  }
});

router.post('/upload/:itemId', requireIntegrationAdmin, express.raw({
  type: ['image/jpeg', 'image/jpg'],
  limit: '8mb'
}), async (req, res) => {
  try {
    const itemId = String(req.params.itemId || '');
    const target = imagePath(itemId);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Arquivo de imagem vazio.' });
    }
    await ensureImageDir();
    await fs.writeFile(target, req.body);
    return res.json({ ok: true, itemId });
  } catch (error) {
    console.error('Erro ao salvar imagem Shopee:', error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Falha ao salvar imagem.'
    });
  }
});

router.post('/finalize', requireIntegrationAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await ensureImageDir();
    for (const id of IMAGE_IDS) {
      await fs.access(imagePath(id));
    }

    const publicBase = (process.env.BACKEND_PUBLIC_URL || ('https://' + req.get('host'))).replace(/\/+$/, '');
    const urlBase = publicBase + '/shopee-images/';

    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('shopee-image-restore'))");

    const existing = await client.query(
      `SELECT external_id
         FROM products
        WHERE source = 'shopee'
          AND external_id = ANY($1::text[])
        FOR UPDATE`,
      [IMAGE_IDS]
    );

    const found = new Set(existing.rows.map(row => String(row.external_id)));
    const missingProducts = IMAGE_IDS.filter(id => !found.has(id));
    if (missingProducts.length) {
      throw new Error('Produtos Shopee ausentes no catálogo: ' + missingProducts.join(', '));
    }

    const result = await client.query(
      `UPDATE products
          SET image_url = $1 || external_id || '.jpg',
              updated_at = now()
        WHERE source = 'shopee'
          AND external_id = ANY($2::text[])
       RETURNING external_id`,
      [urlBase, IMAGE_IDS]
    );

    await client.query('COMMIT');
    return res.json({
      ok: true,
      updated: result.rowCount,
      baseUrl: urlBase
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro na restauração das imagens Shopee:', error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Falha na restauração. Nenhuma alteração foi confirmada.'
    });
  } finally {
    client.release();
  }
});

export default router;
