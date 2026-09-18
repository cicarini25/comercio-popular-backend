# Comércio Popular — Mapa de Integrações 2026

Atualizado em 18/09/2026.

## Objetivo

Construir um hub de catálogo capaz de importar dezenas de milhares de ofertas, normalizar os dados e identificar automaticamente quando ofertas de plataformas diferentes representam o mesmo produto.

O sistema separa três conceitos: API de catálogo/marketplace, API de afiliados e rede de afiliados. Um conector só usa capacidades documentadas ou formalmente liberadas para aquela conta.

## Mercado Livre

A documentação atual disponibiliza `/items/bulk`, com até 20 itens por chamada, e determina a migração das consultas múltiplas antigas até 25/10/2026. O programa de afiliados documenta Gerador de Links, Central de Afiliados e Barra de Afiliados; não localizei uma operação pública documentada de criação de `meli.la`.

Fonte: https://developers.mercadolivre.com.br/itens-e-buscas

## Shopee

Existe um Explorer oficial da Shopee Affiliate Open API em https://open-api.affiliate.shopee.com.br/explorer. O programa confirma links personalizados e que o link precisa ser gerado pela plataforma para elegibilidade de comissão. A conta precisa ser validada para determinar quais operações/API estão habilitadas.

Fontes:
- https://open-api.affiliate.shopee.com.br/explorer
- https://help.shopee.com.br/portal/10/article/163057

## Amazon

A Creators API atual oferece `SearchItems` e `GetItems` com OAuth 2.0, Partner Tag e marketplace. A API substituiu o caminho anterior de PA-API para novas integrações. O acesso depende da habilitação na conta/região.

Fonte: https://associados.amazon.com.br/creatorsapi/docs/en-us/get-started/using-curl

## AliExpress

A documentação oficial antiga de Affiliate API encontrada no portal Alibaba está marcada como descontinuada. Não usaremos essa API como base sem validar o console atual e as permissões disponíveis.

Fontes:
- https://developer.alibaba.com/docs/doc.htm?articleId=118193&docType=1&treeId=674
- https://developer.alibaba.com/docs/doc.htm?articleId=118934&docType=1&treeId=712

## SHEIN

A SHEIN Brasil informa que o programa antigo de afiliados foi encerrado em 29/08/2024 e que a continuidade ocorre pela Nova Plataforma de Afiliados. O material público consultado descreve seleção e compartilhamento de produtos/campanhas, mas não documenta uma API pública de catálogo afiliado equivalente às encontradas em Mercado Livre/Amazon.

Fonte: https://m.shein.com/br/campus--a-1500.html

## Magalu

O Magalu Devs mantém APIs atuais de Produtos/Catálogo, Preços e Estoques com OAuth 2.0. A documentação encontrada é voltada à integração de sellers e canais do ecossistema; isso não comprova uma API pública específica do programa de afiliados.

Fontes:
- https://developers.magalu.com/
- https://developers.magalu.com/docs/apis/products/overview/index.html

## Redes de afiliados

Rakuten Advertising fornece Product Search API, Product Catalog e Deep Links API para publishers, desde que haja parceria com o anunciante. CJ mantém APIs para publishers e Product Feed API para descoberta de produtos.

Fontes:
- https://pubhelp.rakutenadvertising.com/hc/pt-br/articles/5949953174029-Product-Search-API
- https://pubhelp.rakutenadvertising.com/hc/pt-br/articles/5949836672653-API-de-Deep-Links
- https://lab-developers.d.cjpowered.com/

## Arquitetura

Cada provedor entra atrás de um conector independente. A importação é assíncrona e idempotente; a normalização converte títulos, marcas, modelos, GTINs e atributos para um formato comum; o motor de pareamento tenta primeiro identificadores determinísticos e só depois evidência textual/atributos.

Casos ambíguos ficam em revisão. O sistema não deve associar produtos diferentes apenas porque os títulos são parecidos.

Nenhum segredo fica no frontend. Nenhum cookie é armazenado no GitHub. Scraping não é dependência principal.

## Primeiro marco

Os 13 produtos reais de "TUDO PARA CASA" do Mercado Livre serão a carga de laboratório do pipeline:

ITEM_ID
→ /items/bulk
→ normalização
→ oferta
→ candidatos
→ score
→ automático/revisão.

Depois o mesmo pipeline receberá Shopee, Amazon, AliExpress e, conforme o acesso real das contas, os demais provedores.
