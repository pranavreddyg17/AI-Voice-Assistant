import { useState, useEffect, useRef, useCallback } from 'react'
import {
  uploadDocument,
  uploadVoice,
  cloneVoice,
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
  { id: 1, label: 'UPLOAD', icon: '📄' },
  { id: 2, label: 'DESCRIBE', icon: '💬' },
  { id: 3, label: 'REVIEW', icon: '📋' },
  { id: 4, label: 'APPROVE', icon: '✅' },
  { id: 5, label: 'CALL', icon: '📞' },
]

const STEP_META = {
  1: { title: 'Upload Your Policy', sub: 'Upload your insurance policy document so we can analyze it' },
  2: { title: 'Describe Your Issue', sub: 'Record a voice message or type your insurance problem' },
  3: { title: 'Review Your Case', sub: 'AI-generated case summary and negotiation script' },
  4: { title: 'Approve the Script', sub: 'Review, edit, and approve the negotiation script' },
  5: { title: 'Start the Call', sub: 'Live call simulation with the insurance company' },
}

/* ── Waveform ── */
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
  const [loadingMsg, setLoadingMsg] = useState('')
  const [error, setError] = useState(null)
  const [currentTime, setCurrentTime] = useState('')

  // Doc state
  const [docFile, setDocFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [chunksIngested, setChunksIngested] = useState(0)
  const fileInputRef = useRef(null)

  // Voice / describe state
  const [recording, setRecording] = useState(false)
  const [recDuration, setRecDuration] = useState(0)
  const [audioBlob, setAudioBlob] = useState(null)
  const [transcript, setTranscript] = useState('')
  const [typedProblem, setTypedProblem] = useState('')
  const recorderRef = useRef(null)
  const timerRef = useRef(null)

  // Case analysis state
  const [caseSummary, setCaseSummary] = useState(null)
  const [ragChunks, setRagChunks] = useState([])

  // Script state
  const [fullScript, setFullScript] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [scriptConfirmed, setScriptConfirmed] = useState(false)

  // Call state
  const [voiceId, setVoiceId] = useState(null)
  const [callStatus, setCallStatus] = useState('ready')
  const [callTranscript, setCallTranscript] = useState([])
  const [callDuration, setCallDuration] = useState(0)
  const [agentInput, setAgentInput] = useState('')
  const [ws, setWs] = useState(null)
  const [cloningVoice, setCloningVoice] = useState(false)
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

  // Auto-clear error after 8s
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 8000)
      return () => clearTimeout(t)
    }
  }, [error])

  // Call duration timer
  useEffect(() => {
    if (callStatus !== 'connected') return
    const iv = setInterval(() => setCallDuration(d => d + 1), 1000)
    return () => clearInterval(iv)
  }, [callStatus])

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
  }, [callTranscript])

  // Start voice cloning in background when we have audio and session
  useEffect(() => {
    if (audioBlob && sessionId && !voiceId && !cloningVoice) {
      setCloningVoice(true)
      const file = new File([audioBlob], 'recording.webm', { type: 'audio/webm' })
      cloneVoice(file, sessionId)
        .then(res => { if (res.voice_id) setVoiceId(res.voice_id) })
        .catch(() => { /* Voice cloning failed silently — call will use default voice */ })
        .finally(() => setCloningVoice(false))
    }
  }, [audioBlob, sessionId, voiceId, cloningVoice])

  const fmtTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const fmtSize = b => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`
  const getNow = () => new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const userProblem = (transcript || typedProblem || '').trim()

  /* ── Step 1: Upload Document ── */
  const handleDocUpload = async () => {
    if (!docFile) return
    setLoading(true)
    setLoadingMsg('Analyzing your policy document...')
    setError(null)
    try {
      const res = await uploadDocument(docFile, sessionId)
      if (res.session_id) setSessionId(res.session_id)
      setChunksIngested(res.chunks_ingested || 0)
      setStep(2)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMsg('')
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

  /* ── Step 2: Voice recording ── */
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
      setError('Microphone access denied. You can type your problem instead.')
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
    setCloningVoice(false)
  }

  /* ── Step 2→3: Process voice and generate case summary ── */
  const handleDescribeNext = async () => {
    setLoading(true)
    setError(null)

    try {
      // If we have audio, transcribe it first
      if (audioBlob && !transcript) {
        setLoadingMsg('Transcribing your recording...')
        const file = new File([audioBlob], 'recording.webm', { type: 'audio/webm' })
        const voiceRes = await uploadVoice(file, sessionId)
        if (voiceRes.session_id) setSessionId(voiceRes.session_id)
        const t = voiceRes.transcript || ''
        setTranscript(t)

        // Now generate case summary with the transcript
        const problem = (t || typedProblem || '').trim()
        if (!problem) {
          setError('Please describe your problem — either record a voice message or type it below.')
          setLoading(false)
          setLoadingMsg('')
          return
        }
        setLoadingMsg('Analyzing your case...')
        const sumRes = await getCaseSummary(voiceRes.session_id || sessionId, problem)
        setCaseSummary(sumRes.case_summary)
        setRagChunks(sumRes.rag_chunks || [])

        setLoadingMsg('Generating negotiation script...')
        const scriptRes = await generateScript(voiceRes.session_id || sessionId, problem, sumRes.case_summary)
        setFullScript(scriptRes.script?.full_script || JSON.stringify(scriptRes.script, null, 2))
        setStep(3)
      } else {
        // Text-only path
        const problem = typedProblem.trim()
        if (!problem) {
          setError('Please describe your problem — either record a voice message or type it below.')
          setLoading(false)
          setLoadingMsg('')
          return
        }
        setLoadingMsg('Analyzing your case...')
        const sumRes = await getCaseSummary(sessionId, problem)
        setCaseSummary(sumRes.case_summary)
        setRagChunks(sumRes.rag_chunks || [])

        setLoadingMsg('Generating negotiation script...')
        const scriptRes = await generateScript(sessionId, problem, sumRes.case_summary)
        setFullScript(scriptRes.script?.full_script || JSON.stringify(scriptRes.script, null, 2))
        setStep(3)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
      setLoadingMsg('')
    }
  }

  /* ── Step 3→4: Move to approval ── */
  const handleProceedToApproval = () => setStep(4)

  /* ── Step 4→5: Approve script ── */
  const handleApproveScript = async () => {
    setLoading(true)
    setLoadingMsg('Saving your approved script...')
    setError(null)
    try {
      await approveScript(sessionId, fullScript)
      setScriptConfirmed(true)
      setTimeout(() => {
        setStep(5)
        setLoading(false)
        setLoadingMsg('')
      }, 600)
    } catch (err) {
      setError(err.message)
      setLoading(false)
      setLoadingMsg('')
    }
  }

  /* ── Step 5: Call ── */
  const handleStartCall = async () => {
    setCallStatus('dialing')
    setCallTranscript([])
    setCallDuration(0)
    setError(null)
    try {
      await startCall(sessionId, fullScript, userProblem)
      const url = getCallWebSocketUrl(sessionId)
      const socket = new WebSocket(url)
      socket.onopen = () => setCallStatus('connected')
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
      socket.onerror = () => {
        setError('Connection lost. Please try again.')
        setCallStatus('ready')
      }
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
      try { ws.send(JSON.stringify({ type: 'end_call' })) } catch { }
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
      {error && <div className="error-toast" onClick={() => setError(null)}>⚠ {error}</div>}

      {/* Header */}
      <header className="header">
        <div className="header-brand">
          <div className="brand-icon">📡</div>
          <div className="brand-text">
            <div className="brand-name">Insurance Voice Assistant</div>
            <div className="brand-sub">AI-POWERED POLICY NEGOTIATION</div>
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
          <span><span className="status-dot" />ONLINE</span>
          <span>{currentTime}</span>
        </div>
      </header>

      {/* Main */}
      <main className="main-content">
        <div className="step-title">
          <div className="step-counter">
            Step {step} <span className="dim">of 5</span>
          </div>
          <h1 className="step-heading">{meta.title}</h1>
          <p className="step-subtitle">{meta.sub}</p>
        </div>

        <div className={`main-card ${step >= 3 ? 'active-border' : ''}`}>
          <div className="corner corner-tl" />
          <div className="corner corner-tr" />
          <div className="corner corner-bl" />
          <div className="corner corner-br" />

          {/* ── Step 1: Upload Document ── */}
          {step === 1 && (
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
                    <button className="upload-remove" onClick={e => {
                      e.stopPropagation()
                      setDocFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}>
                      ✕ Remove
                    </button>
                  </div>
                ) : (
                  <div className="upload-file-info">
                    <div className={`upload-icon ${isDragging ? 'active' : ''}`}>{isDragging ? '⬆' : '📄'}</div>
                    <span className="upload-text">Drop your policy document here</span>
                    <span className="upload-hint">PDF, TXT, DOC — Up to 10MB</span>
                  </div>
                )}
              </div>
              <div className="privacy-note">
                <span>🔒</span>
                <p>Your document is processed securely. It's chunked, embedded, and stored in memory for this session only.</p>
              </div>
            </div>
          )}

          {/* ── Step 2: Describe Issue ── */}
          {step === 2 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {chunksIngested > 0 && (
                <div className="privacy-note" style={{ borderColor: 'var(--border-active)', background: 'var(--primary-dim)' }}>
                  <span>✓</span>
                  <p style={{ color: 'var(--primary)' }}>Policy document analyzed — {chunksIngested} sections indexed</p>
                </div>
              )}

              {/* Voice recorder */}
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
                  {recording && recDuration < 10 && <span className="recorder-hint">Keep talking...</span>}
                  {recording && recDuration >= 10 && <span className="recorder-hint ready">Recording captured — tap stop when done</span>}
                  {audioBlob && !recording && <span className="recorder-hint ready">Voice recording saved</span>}
                  {!recording && !audioBlob && <span className="recorder-hint">Tap to record your voice describing the problem</span>}
                </div>

                <Waveform isActive={recording} variant="recording" barCount={64} height={40} />

                <div className="recorder-actions">
                  {recording && (
                    <button className="btn btn-outline" onClick={stopRecording} disabled={recDuration < 3}>
                      ⏹ Stop Recording
                    </button>
                  )}
                  {audioBlob && !recording && (
                    <button className="btn btn-ghost" onClick={resetRecording}>↺ Re-record</button>
                  )}
                </div>
              </div>

              {/* Divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                <span style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', letterSpacing: '0.1em' }}>
                  {audioBlob ? 'OR ALSO TYPE BELOW' : 'OR TYPE YOUR PROBLEM'}
                </span>
                <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
              </div>

              {/* Text input fallback */}
              <textarea
                className="script-textarea"
                style={{ minHeight: '80px' }}
                value={typedProblem}
                onChange={e => setTypedProblem(e.target.value)}
                placeholder="e.g. My health insurance claim for a hospital stay was denied. Policy number is ABC-123. The denial letter says the procedure wasn't covered, but I believe it should be under my plan."
              />
            </div>
          )}

          {/* ── Step 3: Case Review ── */}
          {step === 3 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Case summary */}
              {caseSummary && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div className="script-icon">📋</div>
                    <div className="script-meta">
                      <h3>Case Summary</h3>
                      <p>Based on your policy and described problem</p>
                    </div>
                  </div>
                  <div className="script-display" style={{ minHeight: '120px', maxHeight: '180px' }}>
                    {typeof caseSummary === 'string' ? caseSummary : JSON.stringify(caseSummary, null, 2)}
                  </div>
                </>
              )}

              {/* Script preview */}
              {fullScript && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                    <div className="script-icon">✨</div>
                    <div className="script-meta">
                      <h3>Negotiation Script</h3>
                      <p>AI-generated script ready for your review</p>
                    </div>
                  </div>
                  <div className="script-display" style={{ minHeight: '150px', maxHeight: '250px' }}>
                    {fullScript}
                  </div>
                </>
              )}

              {ragChunks.length > 0 && (
                <div className="privacy-note">
                  <span>📑</span>
                  <p>{ragChunks.length} relevant policy sections were used to generate this analysis</p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 4: Script Approval ── */}
          {step === 4 && (
            <div className="script-editor">
              <div className="script-header">
                <div className="script-header-left">
                  <div className="script-icon">✅</div>
                  <div className="script-meta">
                    <h3>Review & Edit Script</h3>
                    <p>{scriptConfirmed ? 'Script approved!' : 'Make any changes, then approve'}</p>
                  </div>
                </div>
                {!scriptConfirmed && (
                  <button className="btn btn-ghost" onClick={() => setIsEditing(!isEditing)}>
                    {isEditing ? '👁 Preview' : '✏ Edit'}
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
                <div className="script-display">
                  {fullScript}
                </div>
              )}

              {scriptConfirmed && (
                <div className="script-confirmed">✓ Script approved and locked in</div>
              )}
            </div>
          )}

          {/* ── Step 5: Call ── */}
          {step === 5 && (
            <div className="call-control">
              <div className="call-header">
                <div className="call-header-left">
                  <div className={`call-icon ${callStatus}`}>
                    {callStatus === 'dialing' ? <span className="spinner" /> : '📞'}
                  </div>
                  <div>
                    <p style={{ fontSize: '0.85rem' }}>Insurance Company Call</p>
                    <span className={`call-status-text ${callStatus === 'connected' ? 'live' : ''}`}>
                      {callStatus === 'ready' && 'Ready to begin'}
                      {callStatus === 'dialing' && 'Connecting...'}
                      {callStatus === 'connected' && `🟢 Live  ·  ${fmtTime(callDuration)}`}
                      {callStatus === 'ended' && 'Call ended'}
                    </span>
                    {cloningVoice && <span className="call-status-text" style={{ fontSize: '0.6rem' }}>Preparing your AI voice...</span>}
                    {voiceId && !cloningVoice && <span className="call-status-text" style={{ fontSize: '0.6rem', color: 'var(--primary)' }}>✓ Voice clone ready</span>}
                  </div>
                </div>
                {callStatus === 'connected' && (
                  <button className="btn btn-danger" onClick={handleEndCall}>End Call</button>
                )}
              </div>

              {(callStatus === 'connected' || callStatus === 'dialing') && (
                <Waveform isActive={callStatus === 'connected'} variant="playback" barCount={96} height={32} />
              )}

              <div ref={transcriptRef} className={`call-transcript-wrap ${callStatus === 'connected' ? 'active' : ''}`}>
                {callTranscript.length === 0 && callStatus !== 'connected' && callStatus !== 'dialing' && (
                  <div className="transcript-empty">
                    <span style={{ fontSize: '2rem', opacity: 0.3 }}>📞</span>
                    <span>{callStatus === 'ready' ? 'Call transcript will appear here' : 'Call complete'}</span>
                  </div>
                )}
                {callStatus === 'dialing' && callTranscript.length === 0 && (
                  <div className="transcript-empty">
                    <div className="dialing-dots">
                      <div className="dialing-dot" />
                      <div className="dialing-dot" />
                      <div className="dialing-dot" />
                    </div>
                    <span>Ringing...</span>
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
                          {entry.role === 'ai' ? 'You (AI)' : 'Insurance Agent'}
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
                  <button className="btn btn-primary" onClick={sendAgentMessage}>Send</button>
                </div>
              )}

              {callStatus === 'ended' && (
                <div className="call-ended-summary">
                  <div><div className="stat-label">Duration</div><div className="stat-value">{fmtTime(callDuration)}</div></div>
                  <div style={{ textAlign: 'right' }}><div className="stat-label">Messages</div><div className="stat-value">{callTranscript.length}</div></div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', marginTop: '1.5rem' }}>
          {/* Loading message */}
          {loading && loadingMsg && (
            <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', letterSpacing: '0.05em' }}>{loadingMsg}</p>
          )}

          {step === 1 && docFile && (
            <button className="btn btn-primary" onClick={handleDocUpload} disabled={loading}>
              {loading ? <><span className="spinner" /> Analyzing document...</> : <>Upload & Continue →</>}
            </button>
          )}
          {step === 2 && (
            <button className="btn btn-primary" onClick={handleDescribeNext} disabled={loading || (!audioBlob && !typedProblem.trim())}>
              {loading ? <><span className="spinner" /> {loadingMsg || 'Processing...'}</> : <>Analyze & Generate Script →</>}
            </button>
          )}
          {step === 3 && (
            <button className="btn btn-primary" onClick={handleProceedToApproval} disabled={loading}>
              Review & Approve Script →
            </button>
          )}
          {step === 4 && !scriptConfirmed && (
            <button className="btn btn-primary btn-full" onClick={handleApproveScript} disabled={loading}>
              {loading ? <><span className="spinner" /> Saving...</> : <>✓ Approve Script</>}
            </button>
          )}
          {step === 5 && callStatus === 'ready' && (
            <button className="btn btn-primary btn-full" onClick={handleStartCall}>
              📞 Start Call Simulation
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
            <span>⚡ Powered by ElevenLabs + Mistral AI</span>
            <span>|</span>
            <span>Qdrant RAG</span>
          </div>
          <span className="footer-version">v1.0.0</span>
        </div>
      </footer>
    </div>
  )
}
