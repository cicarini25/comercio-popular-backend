# Integrações de Afiliados — Status por Plataforma

Levantamento real de como cada plataforma funciona hoje, pra você saber o que dá pra automatizar via API e o que ainda depende de trabalho manual.

## ✅ Têm API própria (dá pra automatizar 100%)

| Plataforma | Programa | Observação |
|---|---|---|
| **Mercado Livre** | Programa de Afiliados e Criadores | Gera link de afiliado automaticamente a partir da URL do produto |
| **Shopee** | Shopee Affiliate Open API | Retorna produtos, comissão e link já formatado |
| **Amazon** | Product Advertising API (Amazon Associates) | Precisa de aprovação prévia no programa antes de liberar a API |
| **AliExpress** | AliExpress Open Platform API | Tem biblioteca oficial e é a mais fácil de integrar |

## ⚠️ Não têm API própria — passam por uma rede de afiliados

| Plataforma | Rede que gerencia | O que isso muda |
|---|---|---|
| **Netshoes** | Rakuten Advertising | Você se cadastra na Rakuten Advertising (não direto na Netshoes) e usa a API deles pra puxar produtos e gerar links |
| **Shein** | CJ Affiliate (Commission Junction) | Mesma lógica: cadastro na CJ Affiliate, e o catálogo/links da Shein vêm de lá |

**Na prática:** o código de integração fica quase igual ao das outras 4 — só muda o provedor da API (Rakuten/CJ no lugar da API própria da loja).

## 🚫 Sem automação de catálogo disponível por enquanto

| Plataforma | Como funciona hoje | Limitação |
|---|---|---|
| **Magalu** | Programa próprio "Magazine Você" (via app) | Não tem API pública de catálogo pra afiliados — a geração de link hoje é manual, produto por produto, dentro do app deles |
| **TikTok Shop** | Modelo baseado em criador marcando produto no vídeo | Feito pra divulgação em conteúdo (vídeo/live), não é uma API de catálogo pensada pra puxar produtos pra um site externo |

**O que fazer com essas duas por enquanto:** cadastrar os produtos manualmente na sua vitrine (usando o formulário de "Cadastrar Novo Produto" que já existe no site) até essas plataformas abrirem uma API de catálogo mais ampla, ou usar essas duas mais para divulgação (compartilhar Achadinhos no TikTok, por exemplo) do que para importação automática.

## O que já foi ajustado no projeto

- O tipo `Platform` no código agora aceita `netshoes`, `shein`, `tiktokshop` e `magalu`, cada uma com sua cor e selo de identificação visual na vitrine
- O banco de dados (`schema.sql`) já aceita essas 4 novas origens no campo `source` dos produtos
- Netshoes e Magalu também entram no critério de "Envio Rápido" (badge), já que ambas têm logística própria robusta (MagaLog)

## Próximo passo recomendado

Comece cadastrando as 4 plataformas com API própria (Mercado Livre, Shopee, Amazon, AliExpress) — são as que trazem retorno mais rápido de automação. Netshoes e Shein entram na sequência via Rakuten/CJ. Magalu e TikTok Shop ficam pra depois, com cadastro manual até elas abrirem mais acesso.
