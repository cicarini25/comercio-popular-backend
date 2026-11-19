import { useEffect, useRef, useState } from 'react'
import { ArrowRight, KeyRound, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import { acceptGoogleLoginTerms, signInWithEmail, signInWithGoogleIdToken, signUpWithEmail } from './accountApi.js'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const TERMS_URL = import.meta.env.VITE_TERMS_URL || ''
const PRIVACY_URL = import.meta.env.VITE_PRIVACY_URL || ''
const LEGAL_DOCUMENTS_READY = Boolean(TERMS_URL && PRIVACY_URL)

function formatCpf(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')
}

export default function AuthScreen({ initialError = '', onAuthenticated }) {
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [cpf, setCpf] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(initialError)
  const [pendingTerms, setPendingTerms] = useState(null)
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [googleError, setGoogleError] = useState('')
  const googleButtonRef = useRef(null)
  const authCallbackRef = useRef(onAuthenticated)

  authCallbackRef.current = onAuthenticated

  useEffect(() => {
    if (!initialError) return
    setMessage(initialError)
  }, [initialError])

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButtonRef.current) return undefined
    let mounted = true

    const renderGoogleButton = () => {
      if (!mounted || !window.google?.accounts?.id || !googleButtonRef.current) return
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        ux_mode: 'popup',
        callback: async (credentialResponse) => {
          if (!credentialResponse?.credential) {
            setGoogleError('O Google não retornou um token de acesso.')
            return
          }
          setBusy(true)
          setMessage('')
          setGoogleError('')
          try {
            const result = await signInWithGoogleIdToken(credentialResponse.credential)
            await acceptAuthResult(result)
          } catch (error) {
            setMessage(error.message)
          } finally {
            setBusy(false)
          }
        },
      })
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        shape: 'rectangular',
        text: 'continue_with',
        width: Math.max(240, Math.min(400, googleButtonRef.current.clientWidth || 360)),
      })
    }

    if (window.google?.accounts?.id) {
      renderGoogleButton()
      return () => { mounted = false }
    }

    let script = document.querySelector('script[data-prometheus-google-identity]')
    if (!script) {
      script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.dataset.prometheusGoogleIdentity = 'true'
      document.head.appendChild(script)
    }
    script.addEventListener('load', renderGoogleButton)
    script.addEventListener('error', () => setGoogleError('Não foi possível carregar a autenticação do Google.'))
    return () => {
      mounted = false
      script?.removeEventListener('load', renderGoogleButton)
    }
  }, [])

  async function acceptAuthResult(result) {
    if (result?.status === 'legal_required' && result.legalToken) {
      setPendingTerms(result)
      setAcceptedTerms(false)
      setMessage('Confirme os termos da conta para concluir o login com Google.')
      return
    }
    if (result?.status !== 'authenticated' || !result?.user?.id) {
      throw new Error('O serviço de contas não confirmou uma sessão válida.')
    }
    await authCallbackRef.current(result.user)
  }

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      if (mode === 'signup') {
        if (cpf.replace(/\D/g, '').length !== 11) throw new Error('Informe um CPF com 11 números.')
        const result = await signUpWithEmail({ name, email, password, cpf: cpf.replace(/\D/g, '') })
        await acceptAuthResult(result)
      } else {
        const result = await signInWithEmail(email, password)
        await acceptAuthResult(result)
      }
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmTerms(event) {
    event.preventDefault()
    if (!pendingTerms || !acceptedTerms || busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await acceptGoogleLoginTerms(pendingTerms.legalToken)
      setPendingTerms(null)
      await acceptAuthResult(result)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy(false)
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode)
    setEmail('')
    setPassword('')
    setCpf('')
    setMessage('')
    setPendingTerms(null)
    setGoogleError('')
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <div className="auth-brand-symbol"><Sparkles size={24} strokeWidth={1.6} /></div>
          <div><strong>PROMETHEUS</strong><span>INTELIGÊNCIA EM MOVIMENTO</span></div>
        </div>
        <div className="auth-heading">
          <p className="eyebrow">SUA CONTA PROMETHEUS</p>
          <h1 id="auth-title">{pendingTerms ? 'Concluir acesso' : mode === 'signup' ? 'Crie sua conta' : 'Entre para conversar'}</h1>
          <p>{pendingTerms ? 'Sua conta Google foi validada. Confirme os termos para concluir a primeira entrada.' : 'Use a conta Prometheus que já existe ou crie uma com e-mail, senha e CPF.'}</p>
        </div>

        {message && <div className="auth-message" role="alert"><ShieldCheck size={16} /><span>{message}</span></div>}

        {pendingTerms ? <form className="legal-confirmation" onSubmit={confirmTerms}>
          <div className="legal-copy">
            <LockKeyhole size={18} />
            <p>O login social exige o aceite registrado pela plataforma de contas. Revise os documentos da conta antes de continuar.</p>
          </div>
          <div className="legal-links">
            {TERMS_URL ? <a href={TERMS_URL} target="_blank" rel="noreferrer">Termos de Serviço</a> : <span>Termos ainda não configurados</span>}
            <span aria-hidden="true">·</span>
            {PRIVACY_URL ? <a href={PRIVACY_URL} target="_blank" rel="noreferrer">Política de Privacidade</a> : <span>Privacidade ainda não configurada</span>}
          </div>
          {!LEGAL_DOCUMENTS_READY && <p className="auth-inline-error">O acesso Google só pode continuar depois que os links oficiais estiverem configurados.</p>}
          <label className="legal-checkbox"><input type="checkbox" checked={acceptedTerms} disabled={!LEGAL_DOCUMENTS_READY} onChange={(event) => setAcceptedTerms(event.target.checked)} /><span>Li e aceito os Termos de Serviço e a Política de Privacidade.</span></label>
          <button className="auth-submit" type="submit" disabled={!acceptedTerms || !LEGAL_DOCUMENTS_READY || busy}>{busy ? 'Confirmando…' : 'Aceitar e continuar'}<ArrowRight size={17} /></button>
        </form> : <>
          <div className="auth-google-area">
            {GOOGLE_CLIENT_ID
              ? <div className="google-button-slot" ref={googleButtonRef} aria-label="Continuar com Google" />
              : <div className="google-disabled"><span className="google-letter">G</span><span>Google será habilitado após configurar o Client ID web.</span></div>}
            {googleError && <p className="auth-inline-error">{googleError}</p>}
          </div>

          <div className="auth-divider"><span>ou use seu e-mail</span></div>
          <form className="auth-form" onSubmit={submit}>
            {mode === 'signup' && <label className="auth-field"><span>Nome</span><div className="auth-input-wrap"><UserRound size={16} /><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Seu nome" required maxLength={150} /></div></label>}
            <label className="auth-field"><span>{mode === 'signup' ? 'E-mail' : 'E-mail ou CPF'}</span><div className="auth-input-wrap"><Mail size={16} /><input type={mode === 'signup' ? 'email' : 'text'} inputMode={mode === 'signup' ? 'email' : 'text'} autoComplete={mode === 'signup' ? 'email' : 'username'} value={email} onChange={(event) => setEmail(event.target.value)} placeholder={mode === 'signup' ? 'nome@exemplo.com' : 'nome@exemplo.com ou CPF'} required maxLength={150} /></div></label>
            {mode === 'signup' && <label className="auth-field"><span>CPF</span><div className="auth-input-wrap"><ShieldCheck size={16} /><input inputMode="numeric" autoComplete="off" value={formatCpf(cpf)} onChange={(event) => setCpf(event.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="000.000.000-00" required /></div><small>Usado para criar sua conta Prometheus.</small></label>}
            <label className="auth-field"><span>Senha</span><div className="auth-input-wrap"><KeyRound size={16} /><input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === 'signup' ? 'Mínimo de 6 caracteres' : 'Sua senha'} required minLength={mode === 'signup' ? 6 : undefined} /></div></label>
            <button className="auth-submit" type="submit" disabled={busy}>{busy ? 'Aguarde…' : mode === 'signup' ? 'Criar conta' : 'Entrar com e-mail'}<ArrowRight size={17} /></button>
          </form>

          <div className="auth-switch">
            {mode === 'login' ? <><span>Ainda não tem uma conta?</span><button type="button" onClick={() => switchMode('signup')}>Criar conta</button></> : <><span>Já tem uma conta?</span><button type="button" onClick={() => switchMode('login')}>Entrar</button></>}
          </div>
        </>}

        <div className="auth-footer"><LockKeyhole size={13} /><span>Suas credenciais são validadas pelo serviço de contas. A sessão do chat expira após 8 horas.</span></div>
      </section>
    </main>
  )
}
