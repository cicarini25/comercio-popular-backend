import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  FileSearch,
  Globe2,
  LockKeyhole,
  Menu,
  MessageCircle,
  MessageSquareText,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  SquarePen,
  X,
  Zap,
} from 'lucide-react'
import AuthScreen from './AuthScreen.jsx'
import {
  createConversation,
  deleteConversation,
  endPrometheusSession,
  getPrometheusSession,
  listConversationMessages,
  listConversations,
  listProviders,
  refreshConversationMessage,
  sendConversationMessage,
} from './prometheusApi.js'

const starters = [
  { icon: Sparkles, title: 'Tire uma ideia do papel', text: 'Estruture um projeto em etapas claras.' },
  { icon: FileSearch, title: 'Entenda um assunto', text: 'Receba uma explicação direta e organizada.' },
  { icon: MessageSquareText, title: 'Escreva melhor', text: 'Rascunhe, revise ou ajuste o tom de um texto.' },
]

const providerMetadata = {
  ollama: { name: 'Ollama', detail: 'Modelo local', status: 'Disponível' },
  manus: { name: 'Manus', detail: 'Tarefas privadas de agente', status: 'Disponível' },
  openai: { name: 'OpenAI', detail: 'Retomar após compra de créditos', status: 'Em pausa' },
  claude: { name: 'Claude', detail: 'Retomar após compra de créditos', status: 'Em pausa' },
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function displayMessage(message) {
  return { ...message, text: message.content }
}

function titleFromMessage(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > 70 ? `${normalized.slice(0, 67).trim()}…` : normalized
}

function App() {
  const [session, setSession] = useState(null)
  const [sessionLoading, setSessionLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [page, setPage] = useState('chat')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [providerOpen, setProviderOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [loadingConversation, setLoadingConversation] = useState(false)
  const [providerInfo, setProviderInfo] = useState({})
  const [selectedProvider, setSelectedProvider] = useState('ollama')
  const composerRef = useRef(null)

  const activeConversation = conversations.find((item) => item.id === activeConversationId)
  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase('pt-BR')
    if (!term) return conversations
    return conversations.filter((item) => item.title.toLocaleLowerCase('pt-BR').includes(term))
  }, [conversations, searchTerm])
  const pendingManusIds = useMemo(() => (activeConversation?.messages || [])
    .filter((message) => message.role === 'assistant' && message.provider === 'manus' && message.status === 'running')
    .map((message) => message.id), [activeConversation])
  const pendingManusKey = pendingManusIds.join(',')
  const activeProvider = providerInfo[selectedProvider]
  const providerReady = Boolean(activeProvider?.configured)

  useEffect(() => {
    let mounted = true
    getPrometheusSession()
      .then((result) => { if (mounted) setSession(result.user) })
      .catch((error) => {
        if (!mounted) return
        if (error.status !== 401) setAuthError(error.message)
        setSession(null)
      })
      .finally(() => { if (mounted) setSessionLoading(false) })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!session?.id) return undefined
    let mounted = true
    Promise.all([listConversations(), listProviders()])
      .then(([history, providerStatus]) => {
        if (!mounted) return
        setConversations((history.conversations || []).map((conversation) => ({ ...conversation, messages: [] })))
        setProviderInfo(providerStatus.providers || {})
        const available = providerStatus.providers || {}
        if (!available.ollama?.configured && available.manus?.configured) setSelectedProvider('manus')
      })
      .catch((error) => { if (mounted) setNotice(error.message) })
    return () => { mounted = false }
  }, [session?.id])

  useEffect(() => {
    if (!session || !activeConversationId || !pendingManusIds.length) return undefined
    let stopped = false
    const poll = async () => {
      const results = await Promise.allSettled(pendingManusIds.map((messageId) =>
        refreshConversationMessage(activeConversationId, messageId)))
      if (stopped) return
      results.forEach((result) => {
        if (result.status !== 'fulfilled' || !result.value?.message) return
        const message = displayMessage(result.value.message)
        setConversations((current) => current.map((conversation) => conversation.id === activeConversationId
          ? { ...conversation, messages: conversation.messages.map((item) => item.id === message.id ? message : item) }
          : conversation))
      })
    }
    const timer = window.setInterval(poll, 3_500)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [session, activeConversationId, pendingManusKey])

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        startNewChat()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  async function handleAuthenticated(authenticatedUser) {
    setAuthError('')
    try {
      if (!authenticatedUser?.id) throw new Error('A conta retornou dados de sessão incompletos.')
      setSession(authenticatedUser)
      setConversations([])
      setActiveConversationId(null)
      setNotice('')
    } catch (error) {
      setAuthError(error.message)
      throw error
    }
  }

  async function signOut() {
    try { await endPrometheusSession() } catch { /* A sessão local também será removida da tela. */ }
    setSession(null)
    setConversations([])
    setActiveConversationId(null)
    setPage('chat')
    setNotice('')
  }

  function startNewChat() {
    setPage('chat')
    setActiveConversationId(null)
    setDraft('')
    setNotice('')
    setSidebarOpen(false)
    window.setTimeout(() => composerRef.current?.focus(), 0)
  }

  async function openConversation(id) {
    setPage('chat')
    setActiveConversationId(id)
    setLoadingConversation(true)
    setNotice('')
    setSidebarOpen(false)
    try {
      const result = await listConversationMessages(id)
      setConversations((current) => current.map((conversation) => conversation.id === id
        ? { ...conversation, messages: (result.messages || []).map(displayMessage) }
        : conversation))
    } catch (error) {
      setNotice(error.message)
    } finally {
      setLoadingConversation(false)
    }
  }

  const sendMessage = useCallback(async (value = draft) => {
    const content = value.trim()
    if (!content || sending) return
    if (!providerReady) {
      setNotice(`${providerMetadata[selectedProvider]?.name || 'Este provedor'} ainda não está conectado ao backend.`)
      return
    }

    setSending(true)
    setPage('chat')
    setNotice('')
    let conversationId = activeConversationId
    try {
      if (!conversationId) {
        const created = await createConversation(titleFromMessage(content))
        conversationId = created.conversation.id
        setActiveConversationId(conversationId)
        setConversations((current) => [{ ...created.conversation, messages: [] }, ...current])
      }

      const optimisticUser = { id: `pending-${makeId()}`, role: 'user', content, text: content, status: 'complete' }
      const optimisticAssistant = {
        id: `pending-${makeId()}`,
        role: 'assistant',
        content: selectedProvider === 'manus' ? 'Enviando tarefa privada à Manus…' : 'Ollama está preparando a resposta…',
        text: selectedProvider === 'manus' ? 'Enviando tarefa privada à Manus…' : 'Ollama está preparando a resposta…',
        status: 'running',
        provider: selectedProvider,
      }
      setConversations((current) => current.map((conversation) => conversation.id === conversationId
        ? { ...conversation, messages: [...conversation.messages, optimisticUser, optimisticAssistant] }
        : conversation))

      const result = await sendConversationMessage(conversationId, content, selectedProvider)
      const userMessage = displayMessage(result.userMessage)
      const assistantMessage = displayMessage(result.assistantMessage)
      setConversations((current) => current.map((conversation) => conversation.id === conversationId
        ? {
            ...conversation,
            title: conversation.title === 'Nova conversa' ? titleFromMessage(content) : conversation.title,
            messages: [...conversation.messages.filter((message) => !message.id.startsWith('pending-')), userMessage, assistantMessage],
          }
        : conversation))
      setDraft('')
      listConversations().then((history) => {
        setConversations((current) => {
          const byId = new Map(current.map((item) => [item.id, item]))
          return (history.conversations || []).map((item) => ({ ...item, messages: byId.get(item.id)?.messages || [] }))
        })
      }).catch(() => {})
    } catch (error) {
      if (conversationId) {
        try {
          const result = await listConversationMessages(conversationId)
          setConversations((current) => current.map((conversation) => conversation.id === conversationId
            ? { ...conversation, messages: (result.messages || []).map(displayMessage) }
            : conversation))
        } catch { /* Preserva o texto no campo para que possa ser reenviado. */ }
      }
      setNotice(error.message)
    } finally {
      setSending(false)
    }
  }, [activeConversationId, draft, providerReady, selectedProvider, sending])

  async function removeConversation(event, id) {
    event.stopPropagation()
    const conversation = conversations.find((item) => item.id === id)
    if (!window.confirm(`Excluir “${conversation?.title || 'esta conversa'}” e todas as mensagens?`)) return
    try {
      await deleteConversation(id)
      setConversations((current) => current.filter((item) => item.id !== id))
      if (activeConversationId === id) setActiveConversationId(null)
      setNotice('Conversa excluída e mensagens removidas.')
    } catch (error) {
      setNotice(error.message)
    }
  }

  function selectProvider(providerId) {
    setProviderOpen(false)
    if (providerMetadata[providerId]?.status === 'Em pausa') {
      setNotice(`${providerMetadata[providerId].name} permanece em pausa até a retomada dos testes com créditos.`)
      return
    }
    setSelectedProvider(providerId)
    const option = providerInfo[providerId]
    if (!option?.configured) setNotice(`${providerMetadata[providerId]?.name} ainda precisa ser conectado ao backend do Prometheus.`)
    else setNotice('')
  }

  function openAegisX() {
    const target = import.meta.env.VITE_AEGISX_URL || (import.meta.env.DEV ? 'http://localhost:8080' : '')
    if (!target) {
      setNotice('Configure VITE_AEGISX_URL no ambiente do Prometheus para abrir a instalação autorizada do AEGIS-X.')
      return
    }
    window.open(target, '_blank', 'noopener,noreferrer')
  }

  if (sessionLoading) return <div className="auth-loading"><span className="status-dot" />Verificando sua sessão Prometheus…</div>
  if (!session) return <AuthScreen initialError={authError} onAuthenticated={handleAuthenticated} />

  return (
    <div className="prometheus-app">
      <div className={`sidebar-scrim ${sidebarOpen ? 'visible' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-block">
          <div className="brand-video-frame">
            <video className="brand-video" src="/prometheus-aegisx-motion.mp4" autoPlay muted loop playsInline aria-label="Logotipo animado Prometheus" />
          </div>
          <div className="brand-caption">
            <span>INTELIGÊNCIA EM MOVIMENTO</span>
            <span>Um espaço para conversar e construir.</span>
          </div>
        </div>

        <button className="new-chat-button" type="button" onClick={startNewChat}>
          <SquarePen size={17} strokeWidth={1.8} />
          <span>Nova conversa</span>
          <span className="shortcut">Ctrl K</span>
        </button>

        <div className="sidebar-section">
          <div className="sidebar-section-heading">
            <span>SUAS CONVERSAS</span>
            <button className="icon-button compact" type="button" aria-label="Pesquisar conversas" onClick={() => setSearchOpen((open) => !open)}>
              {searchOpen ? <X size={15} /> : <Search size={15} />}
            </button>
          </div>
          {searchOpen && <input className="conversation-search" autoFocus value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Buscar conversas" aria-label="Buscar conversas" />}
          <div className="conversation-list">
            {filteredConversations.length === 0
              ? <p className="empty-history">Suas conversas aparecerão aqui.</p>
              : filteredConversations.map((conversation) => (
                <div key={conversation.id} className={`history-item-wrap ${activeConversationId === conversation.id ? 'selected' : ''}`}>
                  <button type="button" className="history-item" onClick={() => openConversation(conversation.id)}>
                    <MessageCircle size={15} strokeWidth={1.7} />
                    <span>{conversation.title}</span>
                  </button>
                  <button className="history-delete" type="button" aria-label={`Excluir ${conversation.title}`} onClick={(event) => removeConversation(event, conversation.id)}><X size={13} /></button>
                </div>
              ))}
          </div>
        </div>

        <div className="sidebar-section tools-section">
          <div className="sidebar-section-heading"><span>FERRAMENTAS</span></div>
          <button className={`tool-link ${page === 'aegis' ? 'selected' : ''}`} type="button" onClick={() => { setPage('aegis'); setNotice(''); setSidebarOpen(false) }}>
            <span className="tool-icon"><ShieldCheck size={17} strokeWidth={1.8} /></span>
            <span className="tool-copy"><strong>AEGIS-X</strong><small>Inteligência cibernética</small></span>
            <ArrowUpRight size={14} className="tool-arrow" />
          </button>
          <p className="tool-note">Ferramenta especializada com acesso próprio.</p>
        </div>

        <div className="sidebar-bottom">
          <div className="preview-status"><span className="status-dot" /><span><strong>Sessão protegida</strong><small>Conversa sincronizada com sua conta</small></span></div>
          <button className="account-button" type="button" onClick={signOut}>
            <span className="account-avatar">{(session.name || session.email || 'P').slice(0, 1).toUpperCase()}</span>
            <span><strong>{session.name || 'Conta Prometheus'}</strong><small>Sair da conta</small></span>
            <ChevronDown size={15} />
          </button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" type="button" aria-label="Abrir menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <div className="topbar-context"><span className="context-mark"><Sparkles size={15} /></span><span>Prometheus</span><span className="context-separator">/</span><span className="context-muted">{page === 'aegis' ? 'Ferramentas' : 'Conversas'}</span></div>
          <div className="topbar-actions">
            <span className="preview-pill"><span className="status-dot" />SESSÃO ATIVA</span>
            <button className="icon-button help-button" type="button" aria-label="Sobre o Prometheus" onClick={() => setNotice('Prometheus é a plataforma de conversa. O AEGIS-X é uma ferramenta especializada, acessada com autorização própria.')}><CircleHelp size={18} /></button>
          </div>
        </header>

        {notice && <div className="notice-banner" role="status"><span>{notice}</span><button className="icon-button compact" type="button" aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={15} /></button></div>}

        {page === 'aegis'
          ? <AegisWorkspace onOpen={openAegisX} />
          : <section className={`chat-stage ${activeConversation ? 'conversation-mode' : ''}`}>
            {activeConversation
              ? loadingConversation && !activeConversation.messages.length
                ? <div className="conversation-loading"><span className="status-dot" />Carregando conversa…</div>
                : <Conversation messages={activeConversation.messages} />
              : <Welcome onSelect={sendMessage} />}
            <div className="composer-wrap">
              <form className="composer" onSubmit={(event) => { event.preventDefault(); void sendMessage() }}>
                <textarea
                  ref={composerRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }}
                  placeholder="Escreva sua mensagem para o Prometheus…"
                  rows={1}
                  aria-label="Mensagem para o Prometheus"
                />
                <div className="composer-bottom">
                  <div className="composer-left">
                    <button className="composer-action" type="button" onClick={() => setNotice('O envio de arquivos será habilitado em uma etapa própria, com validação de tipo, tamanho e privacidade.')} aria-label="Mais opções"><Plus size={17} /></button>
                    <div className="provider-anchor">
                      <button className="model-button" type="button" aria-expanded={providerOpen} onClick={() => setProviderOpen((open) => !open)}><span className="model-spark"><Zap size={13} /></span><span>{activeProvider?.model || providerMetadata[selectedProvider]?.name || 'Escolher modelo'}</span><ChevronDown size={14} /></button>
                      {providerOpen && <div className="provider-menu" role="menu">
                        <div className="provider-menu-title">PROVEDOR DESTA CONVERSA</div>
                        {Object.entries(providerMetadata).map(([id, provider]) => {
                          const isPaused = provider.status === 'Em pausa'
                          const configured = Boolean(providerInfo[id]?.configured)
                          return <button key={id} type="button" className="provider-option" role="menuitem" disabled={isPaused} onClick={() => selectProvider(id)}>
                            <span className="provider-option-copy"><strong>{provider.name}</strong><small>{providerInfo[id]?.reason || providerInfo[id]?.model || provider.detail}</small></span>
                            <span className={`provider-status ${isPaused ? 'paused' : configured ? '' : 'unconfigured'}`}>{isPaused ? 'Em pausa' : configured ? 'Conectado' : 'Configurar'}</span>
                          </button>
                        })}
                      </div>}
                    </div>
                  </div>
                  <button className="send-button" type="submit" disabled={!draft.trim() || sending || !providerReady} aria-label="Enviar mensagem">
                    {sending ? <span className="send-spinner" /> : <ArrowUp size={18} />}
                  </button>
                </div>
              </form>
              <p className="composer-disclaimer"><LockKeyhole size={12} />A mensagem vai ao provedor selecionado. Não envie senhas ou dados sigilosos.</p>
            </div>
          </section>}
      </main>
    </div>
  )
}

function Welcome({ onSelect }) {
  return <div className="welcome-content">
    <div className="welcome-symbol"><Sparkles size={23} strokeWidth={1.6} /></div>
    <p className="eyebrow">SEU ESPAÇO INTELIGENTE</p>
    <h1>Converse. Organize.<br /><span>Construa o próximo passo.</span></h1>
    <p className="welcome-description">Prometheus reúne conversa e ferramentas especializadas em uma experiência só, com cada espaço respeitando sua própria finalidade.</p>
    <div className="starter-grid">
      {starters.map(({ icon: Icon, title, text }) => <button key={title} type="button" className="starter-card" onClick={() => void onSelect(title)}><span className="starter-icon"><Icon size={18} strokeWidth={1.7} /></span><strong>{title}</strong><small>{text}</small><ArrowUpRight className="starter-arrow" size={15} /></button>)}
    </div>
  </div>
}

function Conversation({ messages }) {
  return <div className="message-list">
    {messages.map((message) => <article key={message.id} className={`message-row ${message.role}`}>
      {message.role === 'assistant' && <div className="message-avatar"><Sparkles size={16} /></div>}
      <div className={`message-bubble ${message.status === 'failed' ? 'message-error' : ''}`}>
        {message.role === 'assistant' && message.status === 'running' && <span className="message-progress"><span className="status-dot" />{message.provider === 'manus' ? 'Tarefa privada em andamento' : 'Gerando resposta'}</span>}
        {message.role === 'assistant' && message.provider && <span className="message-provider">{providerMetadata[message.provider]?.name || message.provider}</span>}
        <p>{message.text}</p>
      </div>
    </article>)}
  </div>
}

function AegisWorkspace({ onOpen }) {
  return <section className="aegis-stage">
    <div className="aegis-heading">
      <div className="aegis-emblem"><ShieldCheck size={25} strokeWidth={1.6} /></div>
      <p className="eyebrow">FERRAMENTA ESPECIALIZADA</p>
      <h1>AEGIS-X</h1>
      <p className="aegis-intro">Inteligência cibernética defensiva dentro do Prometheus, para investigar sinais e organizar próximos passos com cautela.</p>
    </div>
    <div className="aegis-cards">
      <div className="aegis-card"><span className="aegis-card-icon"><MessageSquareText size={18} /></span><strong>Triagem e análise</strong><p>Examine eventos, links e indicadores suspeitos em um ambiente especializado.</p></div>
      <div className="aegis-card"><span className="aegis-card-icon"><FileSearch size={18} /></span><strong>Trabalho com evidências</strong><p>Mantenha arquivos e resultados no fluxo defensivo autorizado.</p></div>
      <div className="aegis-card"><span className="aegis-card-icon"><Globe2 size={18} /></span><strong>Contexto separado</strong><p>Conversas gerais não herdam evidências ou histórico do AEGIS-X.</p></div>
    </div>
    <div className="aegis-access-panel">
      <div className="access-copy"><span className="access-check"><Check size={16} /></span><div><strong>Integração por espaço autorizado</strong><p>O AEGIS-X mantém autenticação e permissões próprias. A conta Prometheus não concede acesso automaticamente.</p></div></div>
      <button type="button" className="open-aegis-button" onClick={onOpen}>Abrir ambiente AEGIS-X<ArrowUpRight size={16} /></button>
    </div>
    <p className="aegis-footnote"><LockKeyhole size={13} />A abertura pública desta ferramenta depende de autorização e isolamento de usuários no serviço.</p>
  </section>
}

export default App
