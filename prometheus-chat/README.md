# Prometheus Chat

Aplicação pública independente para conversas gerais. O AEGIS-X continua sendo uma ferramenta defensiva separada e não recebe automaticamente o histórico do chat. A API comercial existente (`/api/prometheus/chat`) permanece fora deste pacote e sem alterações.

## O que esta versão entrega

- Login por e-mail ou CPF e senha; cadastro por e-mail/senha/CPF; Google quando o Client ID, os documentos legais e a origem OAuth estiverem configurados.
- O navegador recebe apenas um cookie de sessão `HttpOnly`; o JWT da conta fica no servidor.
- Conversas e mensagens persistidas por usuário em tabelas próprias no Postgres.
- Ollama e Manus como provedores do chat. OpenAI e Claude permanecem pausados até a retomada dos testes com créditos.
- Manus inicia uma tarefa privada, sem conectores ou habilidades habilitados, e a resposta atualiza na conversa. A tarefa pode levar mais tempo do que uma resposta de chat comum.
- Interface e API servidas no mesmo domínio no Railway, com migração aditiva das três tabelas na inicialização.

## Executar localmente

Use uma instância local do banco de contas; não copie uma `DATABASE_URL` ou uma chave secreta de produção para arquivos locais. O serviço precisa apontar para o mesmo banco e para o mesmo `JWT_SECRET` usados pela API de contas.

1. Em `api`, copie `.env.example` para `.env` e informe as configurações locais do banco, `JWT_SECRET` e `ACCOUNT_API_BASE_URL`.
2. Em `web`, copie `.env.example` para `.env` e informe o Client ID Google local, se for usar esse método, e os links legais da plataforma.
3. Abra dois terminais na pasta `api`: `npm install`, depois `npm run migrate` e `npm run dev`.
4. No outro terminal, entre em `web`, execute `npm install` e `npm run dev`.
5. Abra `http://localhost:5173`.

O frontend local usa a API em `http://localhost:3334` e a conta existente em `http://localhost:3333/api` por padrão. O endereço do Ollama deve ser acessível a partir do processo da API; `localhost` dentro do Railway é o próprio container e não o computador do usuário.

## Railway

O pacote foi preparado para um serviço separado, com diretório raiz `/prometheus-chat`. O serviço existente do Comércio Popular não precisa ser substituído. No novo serviço, use referências do Railway para o banco e para a chave JWT da API de contas; nunca copie esses valores para o frontend.

Configure estas variáveis no serviço de chat:

| Variável | Configuração |
|---|---|
| `DATABASE_URL` | Referência ao `DATABASE_URL` do serviço `Postgres` |
| `JWT_SECRET` | Referência ao `JWT_SECRET` do serviço `comercio-popular-backend` |
| `ACCOUNT_API_BASE_URL` | `https://comercio-popular-backend-production.up.railway.app/api` |
| `PROMETHEUS_ORIGINS` | Origens HTTPS adicionais apenas se a interface e a API forem separadas; o mesmo domínio é liberado automaticamente |
| `PROMETHEUS_COOKIE_SECURE` | `true` |
| `PROMETHEUS_COOKIE_SAME_SITE` | `lax` |
| `PGSSL` | `true` |
| `PGSSL_REJECT_UNAUTHORIZED` | `false`, seguindo a conexão SSL já usada pelo backend de contas no Railway |
| `PROMETHEUS_MANUS_API_KEY` | Chave dedicada à API do chat; não reutilize a configuração privada do AEGIS-X |
| `PROMETHEUS_OLLAMA_BASE_URL` | Endpoint HTTPS ou rede privada alcançável pelo serviço do chat; deixe vazio até existir esse endpoint |
| `PROMETHEUS_OLLAMA_MODEL` | Modelo instalado no endpoint Ollama, por exemplo `llama3.2:3b` |
| `VITE_GOOGLE_CLIENT_ID` | Referência pública ao Client ID web já cadastrado no OAuth do Google |
| `VITE_TERMS_URL` | URL oficial dos Termos de Serviço; indispensável para novos logins Google |
| `VITE_PRIVACY_URL` | URL oficial da Política de Privacidade; indispensável para novos logins Google |
| `VITE_AEGISX_URL` | URL HTTPS da instalação do AEGIS-X, se ela já estiver autorizada para esse público |

As variáveis de build `VITE_GOOGLE_CLIENT_ID`, `VITE_TERMS_URL` e `VITE_PRIVACY_URL` são públicas. Configure o domínio do chat também como origem JavaScript autorizada no OAuth do Google. Sem os dois links legais, a tela bloqueia o aceite inicial do login Google; login por e-mail continua usando a validação da API de contas.

No Postgres, a inicialização cria somente tabelas `prometheus_chat_*` e referências à tabela `users`. Não substitui nem migra as tabelas comerciais. A retenção é até exclusão pelo usuário; as mensagens excluídas seguem a política de backup do Postgres.

## Limites conhecidos

- Este chat não herda ferramentas, arquivos, prompts, logs ou evidências do AEGIS-X.
- Ollama local do computador não fica acessível à Railway automaticamente. O provedor só aparece conectado quando o endpoint está configurado e alcançável pelo backend público.
- Manus trabalha de forma assíncrona e pode continuar no provedor mesmo se a conversa for removida do chat.
- OpenAI/Claude e AEGIS-X não fazem parte desta primeira publicação.
