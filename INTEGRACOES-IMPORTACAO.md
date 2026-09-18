# Comércio Popular — Importação e Pareamento

## Primeiro conector operacional

O backend possui um conector inicial do Mercado Livre que:

1. recebe URLs ou ITEM_IDs;
2. extrai e deduplica ITEM_IDs;
3. consulta a API oficial `/items/bulk` em lotes de até 20;
4. normaliza título, marca, modelo, GTIN e atributos;
5. cria ou atualiza o produto master;
6. cria ou atualiza a oferta Mercado Livre;
7. grava o estado de sincronização;
8. deixa a oferta pronta para o motor de pareamento.

## Endpoint administrativo

`POST /api/integrations/mercadolivre/import`

Cabeçalho:

`Authorization: Bearer <INTEGRATION_ADMIN_TOKEN>`

Corpo:

```json
{
  "category": "Tudo para Casa",
  "items": [
    "MLB3686609545",
    "https://www.mercadolivre.com.br/..."
  ]
}
```

A carga inicial do endpoint é limitada a 1000 itens por execução. O objetivo desse limite é evitar que uma única requisição bloqueie o processo por tempo excessivo. A evolução para 30.000 produtos deve usar jobs de importação, paginação e worker assíncrono.

## Segurança

- `INTEGRATION_ADMIN_TOKEN` fica somente no servidor/Railway.
- `MELI_ACCESS_TOKEN` nunca vai para o frontend.
- Nenhum cookie de sessão é necessário para a consulta de catálogo por `/items/bulk`.
- A geração do link de afiliado é tratada separadamente da importação do catálogo.

## Próxima evolução

Adicionar worker/queue para executar `catalog_import_jobs` em segundo plano e registrar progresso item a item. Depois, adicionar adaptadores dos demais provedores ao mesmo pipeline.
