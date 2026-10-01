# Comércio Popular — primeira importação Shopee

Esta entrega adiciona importação de produtos selecionados do feed CSV, com links originais gerados no painel de afiliados. Não exige Open API da Shopee. Não gera links automaticamente e não importa os 100 mil produtos sem links associados.

## Arquivos

Alterados: src/routes/integrations.js e src/routes/catalog.js.
Novo módulo: src/integrations/shopee/feed-importer.js.
Apoio: scripts/prepare-shopee-feed.py, examples/shopee-links.json, examples/shopee-preview.json, Testar-Shopee.ps1, test/shopee-feed.test.js.
Não há alteração de dependências ou esquema. Usa as tabelas da migração já existente.

## Publicar e testar

1. Guarde o ZIP original como cópia de segurança.
2. Extraia o pacote e atualize no GitHub os arquivos nas mesmas pastas. Não envie node_modules, .env ou tokens.
3. Aguarde o deployment ativo no Railway.
4. Abra PowerShell na pasta extraída que contém Testar-Shopee.ps1 e execute:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Testar-Shopee.ps1
```

O token é digitado oculto. O script faz uma prévia: dryRun=true, count=2; não altera o banco.
Depois de revisar título, preço e links da prévia, importe os dois produtos:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Testar-Shopee.ps1 -Importar
```

Essa segunda execução escreve no banco. Repetir atualiza a oferta existente. O resultado retorna productId, offerId e buyPath.
Abra o domínio do backend seguido de buyPath para conferir o encaminhamento à Shopee. A rota retorna 302 apenas para ofertas/produtos/plataforma ativos e um link curto Shopee válido.
Consulta dos produtos: /api/catalog/products?platform=shopee.

## Limites atuais

- Amostra extraída do feed baixado em 01/10/2026. Preços são um retrato daquela carga. Atualize o CSV antes de usar os dados comercialmente.
- Estoque e disponibilidade não constam no feed: stock_units=NULL e availability=desconhecida. Não inventamos estoque, frete ou comissão.
- Os links do CSV são genéricos. Cada item enviado deve conter affiliateUrl gerado no painel para aquele produto. O administrador é responsável pelo pareamento; o importador valida formato/domínio, não confirma comissão nem resolve cada link na importação.
- A prévia é o padrão; só dryRun=false grava. Máximo 100 produtos por requisição. Todas as gravações da carga estão em uma transação.
- Mantém inativos os produtos/ofertas anteriormente desativados na atualização.
- A rota pública adicionada é exclusiva Shopee. O frontend não veio neste ZIP e precisa ser conferido/adaptado para usar /api/catalog/offers/{offerId}/go no botão Comprar na Shopee.
- Não há agenda automática nem publicação feita por esta entrega. Uma rotina de atualização futura deve preservar os links aprovados, tratar ofertas que saíram do feed e registrar falhas.

## Selecionar outra carga do CSV

Com Python instalado, edite examples/shopee-links.json com IDs e respectivos links curtos gerados no painel (até 100 por carga):

```text
python scripts/prepare-shopee-feed.py catalogo.csv examples/shopee-links.json examples/shopee-preview.json
```

O script lê o CSV inteiro em fluxo, sem carregar os 198 MB na memória, e gera somente os itens selecionados. Falha se faltar ID ou houver duplicata. Sempre produz dryRun=true.

## Verificação executada

Quatro testes novos passaram: amostra real/prévia, validações, atualização/rollback com banco simulado e HTTP (proteção administrativa e redirecionamento). Sintaxe dos arquivos alterados validada. Não houve teste no PostgreSQL de produção nem deployment.
O teste antigo “Mercado Livre quebra lotes em no máximo 20 IDs” falha também no ZIP original: seu mock devolve uma lista vazia, rejeitada pelo conector atual. O código Mercado Livre foi preservado.
