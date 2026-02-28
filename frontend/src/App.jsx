import { useState, useEffect, useRef, useCallback } from 'react'
import {
  uploadDocument,
  uploadVoice,
  getCaseSummary,
  generateScript,
  approveScript,
  startCall,
  getTTS,
  getCallWebSocketUrl,
} from './api'
import './App.css'

/* ── Step config ── */
const STEPS = [
  { id: 1, label: 'CAPTURE', icon: '🎙' },
  { id: 2, label: 'INGEST', icon: '📄' },
  { id: 3, label: 'SUMMARY', icon: '📋' },
  { id: 4, label: 'SCRIPT', icon: '✨' },
  { id: 5, label: 'DEPLOY', icon: '📞' },
]

const STEP_META = {
  1: { title: 'VOICE CAPTURE', sub: 'Record a voice sample describing your insurance problem' },
  2: { title: 'DOCUMENT INGEST', sub: 'Upload your insurance policy for RAG context extraction' },
  3: { title: 'CASE ANALYSIS', sub: 'AI-powered case summary from your voice and document' },
  4: { title: 'SCRIPT REVIEW', sub: 'Review and approve the AI-generated negotiation script' },
  5: { title: 'MISSION CONTROL', sub: 'Live outbound call simulation with real-time transcript' },
}

/* ── Waveform component ── */
function Waveform({ isActive, barCount = 48, height = 48, variant = 'ambient' }) {
  const canvasRef = useRef(null)
  const animRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    const w = rect.width, h = rect.height
    const barW = w / barCount, gap = 2

    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (let i = 0; i < barCount; i++) {
        let bh
        if (isActive && variant === 'recording') {
          const t = Date.now() / 1000
          bh = (Math.sin(t * 3 + i * 0.3) * 0.5 + 0.5) *
            (Math.sin(t * 2 + i * 0.5) * 0.3 + 0.5) * h * 0.7 +
            Math.sin(t * 5 + i * 0.2) * h * 0.1
        } else {
          const t = Date.now() / 2000
          bh = (Math.sin(t + i * 0.15) * 0.3 + 0.5) * h * (isActive ? 0.4 : 0.15)
        }
        bh = Math.max(bh, 2)
        const x = i * barW + gap / 2, y = (h - bh) / 2
        ctx.fillStyle = isActive
          ? (variant === 'recording' ? 'rgba(45,212,191,0.9)' : 'rgba(45,212,191,0.6)')
          : 'rgba(45,212,191,0.15)'
        ctx.beginPath()
        ctx.roundRect(x, y, barW - gap, bh, 1)
        ctx.fill()
      }
      animRef.current = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(animRef.current)
  }, [isActive, barCount, variant])

  return <canvas ref={canvasRef} className="waveform-canvas" style={{ height }} />
}

/* ── Main App ── */
export default function App() {
  const [step, setStep] = useState(1)
  const [sessionId, setSessionId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [currentTime, setCurrentTime] = useState('')

  // Voice state
  const [recording, setRecording] = useState(false)
  const [recDuration, setRecDuration] = useState(0)
  const [audioBlob, setAudioBlob] = useState(null)
  const [transcript, setTranscript] = useState('')
  const [voiceId, setVoiceId] = useState(null)
  const recorderRef = useRef(null)
  const timerRef = useRef(null)

  // Doc state
  const [docFile, setDocFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  // Summary state
  const [caseSummary, setCaseSummary] = useState(null)
  const [typedProblem, setTypedProblem] = useState('')

  // Script state
  const [fullScript, setFullScript] = useState('')
  const [scriptLoading, setScriptLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [scriptConfirmed, setScriptConfirmed] = useState(false)

  // Call state
  const [callStatus, setCallStatus] = useState('ready') // ready | dialing | connected | ended
  const [callTranscript, setCallTranscript] = useState([])
  const [callDuration, setCallDuration] = useState(0)
  const [agentInput, setAgentInput] = useState('')
  const [ws, setWs] = useState(null)
  const transcriptRef = useRef(null)

  // Clock
  useEffect(() => {
    const update = () => {
      const d = new Date()
      setCurrentTime(d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    }
    update()
    const iv = setInterval(update, 1000)
    return () => clearInterval(iv)
  }, [])

  // Auto-clear error
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 6000)
      return () => clearTimeout(t)
    }
  }, [error])

  // Call duration timer
  useEffect(() => {
    if (callStatus !== 'connected') return
    const iv = setInterval(() => setCallDuration(d => d + 1), 1000)
    return () => clearInterval(iv)
  }, [callStatus])

  // Auto scroll transcript
  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
  }, [callTranscript])

  const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const fmtSize = b => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`
  const getNow = () => new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })

  /* ── Voice recording ── */
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks = []
      mr.ondataavailable = e => e.data.size && chunks.push(e.data)
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: 'audio/webm' })
        setAudioBlob(blob)
      }
      mr.start()
      recorderRef.current = mr
      setRecording(true)
      setRecDuration(0)
      timerRef.current = setInterval(() => setRecDuration(d => d + 1), 1000)
    } catch {
      setError('Microphone access denied')
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    if (timerRef.current) clearInterval(timerRef.current)
    setRecording(false)
  }, [])

  const resetRecording = () => {
    setAudioBlob(null)
    setRecDuration(0)
    setTranscript('')
    setVoiceId(null)
  }

  /* ── Step 1→2: Process voice + upload ── */
  const proceedToIngest = async () => {
    if (!audioBlob) return
    const file = new File([audioBlob], 'recording.webm', { type: 'audio/webm' })
    setLoading(true)
    setError(null)
    try {
      const res = await uploadVoice(file, sessionId)
      setTranscript(res.transcript || '')
      setVoiceId(res.voice_id || null)
      if (res.session_id) setSessionId(res.session_id)
      setStep(2)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  /* ── Step 2→3: Upload doc ── */
  const handleDocUpload = async () => {
    if (!docFile) return
    setLoading(true)
    setError(null)
    try {
      const res = await uploadDocument(docFile, sessionId)
      if (res.session_id) setSessionId(res.session_id)
      setStep(3)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDocDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f && (f.name.endsWith('.pdf') || f.name.endsWith('.txt') || f.name.endsWith('.doc') || f.name.endsWith('.docx'))) {
      setDocFile(f)
    }
  }, [])

  /* ── Step 3→4: Generate case summary + script ── */
  const handleCaseSummary = async () => {
    const problem = (transcript || typedProblem || '').trim()
    if (!problem) return
    setLoading(true)
    setError(null)
    try {
      const res = await getCaseSummary(sessionId, problem)
      setCaseSummary(res.case_summary)
      // Auto-generate script
      setScriptLoading(true)
      const scriptRes = await generateScript(sessionId, problem, res.case_summary)
      setFullScript(scriptRes.script?.full_script || JSON.stringify(scriptRes.script, null, 2))
      setStep(4)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setScriptLoading(false)
    }
  }

  /* ── Step 4→5: Approve script ── */
  const handleApproveScript = async () => {
    setLoading(true)
    setError(null)
    try {
      await approveScript(sessionId, fullScript)
      setScriptConfirmed(true)
      setTimeout(() => setStep(5), 800)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  /* ── Step 5: Call ── */
  const handleStartCall = async () => {
    setCallStatus('dialing')
    setCallTranscript([])
    setCallDuration(0)
    setError(null)
    try {
      await startCall(sessionId, fullScript, transcript || typedProblem)
      const url = getCallWebSocketUrl(sessionId)
      const socket = new WebSocket(url)
      socket.onopen = () => {
        setCallStatus('connected')
      }
      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'response') {
          setCallTranscript(prev => [...prev, { role: 'ai', text: msg.text, ts: getNow(), latency: msg.latency_ms }])
          const vid = voiceId || 'EXAVITQu4vr4xnSDxMaL'
          if (msg.text) {
            getTTS(msg.text, vid).then(({ audio_base64 }) => {
              const audio = new Audio(`data:audio/mp3;base64,${audio_base64}`)
              audio.play().catch(() => { })
            }).catch(() => { })
          }
        }
      }
      socket.onerror = () => setError('WebSocket connection error')
      setWs(socket)
    } catch (err) {
      setError(err.message)
      setCallStatus('ready')
    }
  }

  const sendAgentMessage = () => {
    if (!agentInput.trim() || !ws || ws.readyState !== WebSocket.OPEN) return
    const msg = agentInput.trim()
    setAgentInput('')
    setCallTranscript(prev => [...prev, { role: 'agent', text: msg, ts: getNow() }])
    ws.send(JSON.stringify({ type: 'agent_speech', text: msg }))
  }

  const handleEndCall = () => {
    if (ws) {
      ws.send(JSON.stringify({ type: 'end_call' }))
      ws.close()
    }
    setWs(null)
    setCallStatus('ended')
  }

  const meta = STEP_META[step]

  return (
    <div className="app">
      {/* Background */}
      <div className="bg-grid" />
      <div className="bg-glow" />

      {/* Error toast */}
      {error && <div className="error-toast" onClick={() => setError(null)}>{error}</div>}

      {/* Header */}
      <header className="header">
        <div className="header-brand">
          <div className="brand-icon">📡</div>
          <div className="brand-text">
            <div className="brand-name">VOXAI</div>
            <div className="brand-sub">VOICE AGENT COMMAND CENTER</div>
          </div>
        </div>

        {/* Step indicator */}
        <div className="step-indicator">
          {STEPS.map((s, i) => (
            <div key={s.id} className="step-item">
              <div className="step-icon-wrap">
                <div className={`step-icon ${s.id === step ? 'active' : s.id < step ? 'done' : ''}`}>
                  {s.icon}
                </div>
                <span className={`step-label ${s.id === step ? 'active' : s.id < step ? 'done' : ''}`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && <div className={`step-line ${s.id < step ? 'done' : ''}`} />}
            </div>
          ))}
        </div>

        <div className="header-status">
          <span><span className="status-dot" />SYSTEM ONLINE</span>
          <span>{currentTime}</span>
        </div>
      </header>

      {/* Main */}
      <main className="main-content">
        <div className="step-title">
          <div className="step-counter">
            STEP {String(step).padStart(2, '0')} <span className="dim">/ 05</span>
          </div>
          <h1 className="step-heading">{meta.title}</h1>
          <p className="step-subtitle">{meta.sub}</p>
        </div>

        <div className={`main-card ${step >= 3 ? 'active-border' : ''}`}>
          <div className="corner corner-tl" />
          <div className="corner corner-tr" />
          <div className="corner corner-bl" />
          <div className="corner corner-br" />

          {/* ── Step 1: Voice Capture ── */}
          {step === 1 && (
            <div className="recorder">
              <div className="recorder-orb-wrap">
                <div className={`recorder-orb-bg ${recording ? 'recording' : audioBlob ? 'has-recording' : ''}`} />
                {recording && (
                  <>
                    <div className="pulse-ring-1" />
                    <div className="pulse-ring-2" />
                  </>
                )}
                <button
                  className={`recorder-btn ${recording ? 'recording' : audioBlob ? 'has-recording' : ''}`}
                  onClick={recording ? stopRecording : audioBlob ? null : startRecording}
                  disabled={audioBlob && !recording}
                >
                  {recording ? '⏹' : audioBlob ? '✓' : '🎙'}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <span className="recorder-timer">{fmtTime(recDuration)}</span>
                {recording && recDuration < 30 && <span className="recorder-hint">MIN 0:30 REQUIRED</span>}
                {recording && recDuration >= 30 && <span className="recorder-hint ready">READY TO CAPTURE</span>}
                {audioBlob && !recording && <span className="recorder-hint ready">VOICE SAMPLE CAPTURED</span>}
              </div>

              <Waveform isActive={recording} variant="recording" barCount={64} height={48} />

              <div className="recorder-actions">
                {!recording && !audioBlob && <p className="recorder-hint">TAP TO BEGIN VOICE CAPTURE</p>}
                {recording && (
                  <button className="btn btn-outline" onClick={stopRecording} disabled={recDuration < 5}>
                    ⏹ STOP RECORDING
                  </button>
                )}
                {audioBlob && !recording && (
                  <button className="btn btn-ghost" onClick={resetRecording}>↺ RE-RECORD</button>
                )}
              </div>
            </div>
          )}

          {/* ── Step 2: Document Ingest ── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div
                className={`upload-zone ${isDragging ? 'dragging' : ''} ${docFile ? 'has-file' : ''}`}
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDocDrop}
                onClick={() => !docFile && fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.doc,.docx"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) setDocFile(f) }}
                />
                {docFile ? (
                  <div className="upload-file-info">
                    <div className="upload-icon active">✓</div>
                    <span className="upload-file-name">{docFile.name}</span>
                    <span className="upload-file-size">{fmtSize(docFile.size)}</span>
                    <button className="upload-remove" onClick={e => { e.stopPropagation(); setDocFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}>
                      ✕ REMOVE
                    </button>
                  </div>
                ) : (
                  <div className="upload-file-info">
                    <div className={`upload-icon ${isDragging ? 'active' : ''}`}>{isDragging ? '⬆' : '📄'}</div>
                    <span className="upload-text">DROP DOCUMENT HERE</span>
                    <span className="upload-hint">PDF, TXT, DOC — Up to 10MB</span>
                  </div>
                )}
              </div>
              <div className="privacy-note">
                <span>🛡</span>
                <p>Your document is chunked locally, embedded with Mistral, and stored in an in-memory Qdrant instance. Nothing leaves the session.</p>
              </div>
            </div>
          )}

          {/* ── Step 3: Case Analysis ── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {transcript && (
                <div className="privacy-note">
                  <span>💬</span>
                  <p><strong>Your problem (transcribed):</strong> {transcript}</p>
                </div>
              )}
              {!transcript && (
                <div>
                  <label style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', letterSpacing: '0.1em', marginBottom: '0.5rem', display: 'block' }}>
                    DESCRIBE YOUR PROBLEM
                  </label>
                  <input
                    className="agent-input"
                    style={{ width: '100%' }}
                    value={typedProblem}
                    onChange={e => setTypedProblem(e.target.value)}
                    placeholder="e.g. They denied my claim for hospital stay, policy 12345"
                  />
                </div>
              )}
              {caseSummary && (
                <div className="script-display" style={{ minHeight: '150px', maxHeight: '200px' }}>
                  {JSON.stringify(caseSummary, null, 2)}
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Script Review ── */}
          {step === 4 && (
            <div className="script-editor">
              <div className="script-header">
                <div className="script-header-left">
                  <div className="script-icon">✨</div>
                  <div className="script-meta">
                    <h3>GENERATED SCRIPT</h3>
                    <p>{scriptLoading ? 'GENERATING VIA MISTRAL...' : 'GENERATION COMPLETE'}</p>
                  </div>
                </div>
                {!scriptConfirmed && (
                  <button className="btn btn-ghost" onClick={() => setIsEditing(!isEditing)}>
                    {isEditing ? '👁 PREVIEW' : '✏ EDIT'}
                  </button>
                )}
              </div>

              {isEditing ? (
                <textarea
                  className="script-textarea"
                  value={fullScript}
                  onChange={e => setFullScript(e.target.value)}
                />
              ) : (
                <div className={`script-display ${scriptLoading ? 'streaming' : ''}`}>
                  {scriptLoading && <div className="live-badge"><div className="live-dot" /> LIVE</div>}
                  {fullScript}
                  {scriptLoading && <span className="cursor-blink" />}
                </div>
              )}

              {scriptConfirmed && (
                <div className="script-confirmed">✓ SCRIPT LOCKED IN</div>
              )}
            </div>
          )}

          {/* ── Step 5: Mission Control ── */}
          {step === 5 && (
            <div className="call-control">
              <div className="call-header">
                <div className="call-header-left">
                  <div className={`call-icon ${callStatus}`}>
                    {callStatus === 'dialing' ? <span className="spinner" /> : '📞'}
                  </div>
                  <div>
                    <p style={{ fontSize: '0.85rem' }}>Insurance Company</p>
                    <span className={`call-status-text ${callStatus === 'connected' ? 'live' : ''}`}>
                      {callStatus === 'ready' && 'READY TO DEPLOY'}
                      {callStatus === 'dialing' && 'ESTABLISHING CONNECTION...'}
                      {callStatus === 'connected' && `🟢 LIVE  |  ⏱ ${fmtTime(callDuration)}`}
                      {callStatus === 'ended' && 'CALL TERMINATED'}
                    </span>
                  </div>
                </div>
                {callStatus === 'connected' && (
                  <button className="btn btn-danger" onClick={handleEndCall}>📵 END CALL</button>
                )}
              </div>

              {(callStatus === 'connected' || callStatus === 'dialing') && (
                <Waveform isActive={callStatus === 'connected'} variant={callStatus === 'connected' ? 'playback' : 'ambient'} barCount={96} height={32} />
              )}

              <div ref={transcriptRef} className={`call-transcript-wrap ${callStatus === 'connected' ? 'active' : ''}`}>
                {callTranscript.length === 0 && callStatus !== 'connected' && callStatus !== 'dialing' && (
                  <div className="transcript-empty">
                    <span style={{ fontSize: '2rem', opacity: 0.3 }}>📞</span>
                    <span>{callStatus === 'ready' ? 'TRANSCRIPT WILL APPEAR HERE' : 'CALL COMPLETE'}</span>
                  </div>
                )}
                {callStatus === 'dialing' && callTranscript.length === 0 && (
                  <div className="transcript-empty">
                    <div className="dialing-dots">
                      <div className="dialing-dot" />
                      <div className="dialing-dot" />
                      <div className="dialing-dot" />
                    </div>
                    <span>RINGING...</span>
                  </div>
                )}
                {callTranscript.map((entry, i) => (
                  <div key={i} className="transcript-entry">
                    <div className={`transcript-badge ${entry.role}`}>
                      {entry.role === 'ai' ? 'AI' : 'AG'}
                    </div>
                    <div className="transcript-content">
                      <div>
                        <span className={`transcript-role ${entry.role}`}>
                          {entry.role === 'ai' ? 'YOU (AI)' : 'AGENT'}
                        </span>
                        <span className="transcript-ts">{entry.ts}</span>
                        {entry.latency && <span className="transcript-ts">({entry.latency.toFixed(0)}ms)</span>}
                      </div>
                      <p className="transcript-text">{entry.text}</p>
                    </div>
                  </div>
                ))}
              </div>

              {callStatus === 'connected' && (
                <div className="agent-input-wrap">
                  <input
                    className="agent-input"
                    value={agentInput}
                    onChange={e => setAgentInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && sendAgentMessage()}
                    placeholder="Type what the insurance agent says..."
                  />
                  <button className="btn btn-primary" onClick={sendAgentMessage}>SEND</button>
                </div>
              )}

              {callStatus === 'ended' && (
                <div className="call-ended-summary">
                  <div><div className="stat-label">CALL DURATION</div><div className="stat-value">{fmtTime(callDuration)}</div></div>
                  <div style={{ textAlign: 'right' }}><div className="stat-label">MESSAGES</div><div className="stat-value">{callTranscript.length}</div></div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
          {step === 1 && audioBlob && !recording && (
            <button className="btn btn-primary" onClick={proceedToIngest} disabled={loading}>
              {loading ? <><span className="spinner" /> PROCESSING...</> : <>PROCEED TO INGEST →</>}
            </button>
          )}
          {step === 2 && docFile && (
            <button className="btn btn-primary" onClick={handleDocUpload} disabled={loading}>
              {loading ? <><span className="spinner" /> INGESTING...</> : <>GENERATE ANALYSIS →</>}
            </button>
          )}
          {step === 3 && !caseSummary && (
            <button className="btn btn-primary" onClick={handleCaseSummary} disabled={loading || !(transcript || typedProblem)}>
              {loading ? <><span className="spinner" /> ANALYZING...</> : <>ANALYZE CASE →</>}
            </button>
          )}
          {step === 4 && !scriptConfirmed && (
            <button className="btn btn-primary btn-full" onClick={handleApproveScript} disabled={loading}>
              {loading ? <><span className="spinner" /> APPROVING...</> : <>✓ CONFIRM SCRIPT</>}
            </button>
          )}
          {step === 5 && callStatus === 'ready' && (
            <button className="btn btn-primary btn-full" onClick={handleStartCall} disabled={loading}>
              {loading ? <><span className="spinner" /> CONNECTING...</> : <>📞 INITIATE OUTBOUND CALL</>}
            </button>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <div style={{ opacity: 0.3 }}>
          <Waveform isActive={false} variant="ambient" barCount={120} height={24} />
        </div>
        <div className="footer-bar">
          <div className="footer-tech">
            <span>⚡ POWERED BY ELEVENLABS + MISTRAL</span>
            <span>|</span>
            <span>QDRANT RAG</span>
            <span>|</span>
            <span>WEBSOCKET LIVE</span>
          </div>
          <span className="footer-version">v1.0.0</span>
        </div>
      </footer>
    </div>
  )
}
