# SHEIN — importação de produtos

Nesta implementação, a importação é assistida: você gera o link no
**Link do conversor** e envia os dados do produto para o endpoint administrativo.

## Passo a passo

1. Monte uma planilha com as colunas:
   `id, titulo, preco, preco_original, imagem_url, link_afiliado, link_produto, categoria`
   - `id`: número do produto na SHEIN (aparece no endereço, depois de `-p-`).
   - `link_afiliado`: link gerado no painel (Link do conversor).
   - `preco_original`, `link_produto` e `categoria` são opcionais.
2. Salve como CSV e converta:
   `node scripts/prepare-shein-feed.mjs produtos-shein.csv > shein-import.json`
3. Prévia (não grava nada):
   `POST /api/integrations/shein/import-feed` com `Authorization: Bearer <INTEGRATION_ADMIN_TOKEN>`
   e o conteúdo do JSON (`"dryRun": true`).
4. Conferiu? Mude para `"dryRun": false` e envie de novo. Reenviar o mesmo `id` atualiza o produto.

Limite: 200 produtos por envio.

## Segurança

- Só aceita links `https` dos domínios de afiliado permitidos. Padrão: `shein.top` e `onelink.shein.com`.
  Se o seu Link do conversor gerar outro domínio, defina no Railway:
  `SHEIN_AFFILIATE_HOSTS=dominio1.com,dominio2.com`
- Endereço do produto: padrão `br.shein.com` (`SHEIN_PRODUCT_HOSTS` para ajustar).
- O botão de compra usa `GET /api/catalog/offers/:id/go`, que só redireciona para o link de afiliado salvo.
