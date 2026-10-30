# Comércio Popular — Back-end

API real que grava usuários e pedidos no banco de dados e processa pagamentos pelo Mercado Pago.

## O que já está pronto
- Cadastro e login reais (senha criptografada, nunca salva em texto puro)
- Sessão segura via token (JWT)
- Criação de pedido no banco de dados
- Geração do link de pagamento no Mercado Pago (Checkout Pro)
- Webhook que atualiza o pedido automaticamente quando o pagamento é aprovado
- Split 1:1 preparado com OAuth individual por vendedor, renovação criptografada de tokens e comissão configurável

## Split de pagamentos Mercado Pago

O split fica desativado por padrão (`MERCADOPAGO_SPLIT_ENABLED=false`). Quando habilitado, cada vendedor precisa conectar a própria conta Mercado Pago por OAuth no botão **Conectar conta** do painel. O checkout é criado com o token OAuth do vendedor e usa o modelo Split 1:1 do Checkout Pro.

As regras atuais preservam o plano comercial do site: a comissão por venda começa em **0%**, a taxa fixa começa em **R$ 0,00**, e o frete é incluído no valor do vendedor porque é responsabilidade da loja. A taxa do Mercado Pago continua sendo descontada pelo próprio Mercado Pago. Qualquer alteração de comissão deve ser feita somente nas variáveis do backend, nunca aceita do navegador.

Antes de ativar em produção, crie no Mercado Pago uma aplicação de Marketplace com Redirect URI apontando para `/api/mercadopago/marketplace/callback`, configure `MERCADOPAGO_CLIENT_ID`, `MERCADOPAGO_CLIENT_SECRET`, `MERCADOPAGO_REDIRECT_URI` e uma chave independente em `MERCADOPAGO_OAUTH_ENCRYPTION_KEY`. Depois configure a assinatura de Webhooks em `MERCADOPAGO_WEBHOOK_SECRET`, teste com contas de teste e só então altere `MERCADOPAGO_SPLIT_ENABLED=true` e `MERCADOPAGO_REQUIRE_WEBHOOK_SIGNATURE=true` no Railway.

## O que ainda falta (próxima etapa)
- Conectar essas rotas no site (front-end) no lugar da simulação atual
- Biometria facial e SMS reais (precisam de conta paga em um serviço de KYC, como Unico ou idwall, e Twilio/Zenvia — ainda não configuramos nenhum)

## Passo a passo para colocar no ar

### 1. Criar o banco de dados PostgreSQL
1. Crie uma conta gratuita em **railway.app** ou **render.com**
2. Crie um novo banco PostgreSQL
3. Copie a "Connection String" (URL do banco) que eles geram

### 2. Configurar as variáveis de ambiente
1. Copie o arquivo `.env.example` e renomeie para `.env`
2. Cole a URL do banco em `DATABASE_URL`
3. Gere uma senha aleatória longa para `JWT_SECRET` (pode usar um gerador de senha qualquer)
4. Pegue seu **Access Token de produção** no painel do Mercado Pago (Suas integrações → Credenciais) e cole em `MERCADOPAGO_ACCESS_TOKEN`
5. Preencha `FRONTEND_URL` com a URL do seu site depois que o domínio estiver ativo

### 3. Instalar e rodar
```bash
npm install
npm run migrate   # cria as tabelas no banco de dados
npm start         # inicia o servidor
```

### 4. Publicar (deploy)
1. Suba esta pasta para um repositório no GitHub
2. Conecte o repositório na Railway ou Render
3. Configure lá as mesmas variáveis de ambiente do `.env`
4. Após o deploy, você terá uma URL pública (ex: `https://comercio-popular-api.up.railway.app`) — essa é a `BACKEND_PUBLIC_URL` que também precisa ser configurada como variável de ambiente

### ⚠️ Importante sobre segurança
- Nunca compartilhe o conteúdo do `.env` em chat, e-mail ou WhatsApp — ele contém as chaves reais de pagamento
- Nunca suba o arquivo `.env` para o GitHub (o `.gitignore` já está configurado para ignorá-lo)
