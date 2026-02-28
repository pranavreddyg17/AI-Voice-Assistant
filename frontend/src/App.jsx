import { useState } from 'react'
import { uploadDocument, uploadVoice, getCaseSummary, generateScript, approveScript, startCall, getTTS, getCallWebSocketUrl } from './api'
import './App.css'

const STEPS = {
  UPLOAD: 1,
  VOICE: 2,
  SUMMARY: 3,
  SCRIPT: 4,
  CALL: 5,
}

function App() {
  const [step, setStep] = useState(STEPS.UPLOAD)
  const [sessionId, setSessionId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [transcript, setTranscript] = useState('')
  const [voiceId, setVoiceId] = useState(null)
  const [caseSummary, setCaseSummary] = useState(null)
  const [script, setScript] = useState(null)
  const [fullScript, setFullScript] = useState('')
  const [ragChunks, setRagChunks] = useState([])
  const [callTranscript, setCallTranscript] = useState([])
  const [typedProblem, setTypedProblem] = useState('')
  const [agentInput, setAgentInput] = useState('')
  const [ws, setWs] = useState(null)
  const [callActive, setCallActive] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recorder, setRecorder] = useState(null)

  const handleDocumentUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const res = await uploadDocument(file, sessionId)
      setSessionId(res.session_id)
      setStep(STEPS.VOICE)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const startVoiceRecord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream)
      const chunks = []
      mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const file = new File([blob], 'recording.webm', { type: 'audio/webm' })
        setLoading(true)
        setError(null)
        try {
          const res = await uploadVoice(file, sessionId)
          setTranscript(res.transcript)
          setVoiceId(res.voice_id)
          if (res.session_id) setSessionId(res.session_id)
          setStep(STEPS.SUMMARY)
        } catch (err) {
          setError(err.message)
        } finally {
          setLoading(false)
        }
      }
      mediaRecorder.start()
      setRecorder(mediaRecorder)
      setRecording(true)
    } catch (err) {
      setError('Microphone access denied')
    }
  }

  const stopVoiceRecord = () => {
    if (recorder && recording) {
      recorder.stop()
      setRecording(false)
      setRecorder(null)
    }
  }

  const handleVoiceFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const res = await uploadVoice(file, sessionId)
      setTranscript(res.transcript)
      setVoiceId(res.voice_id)
      if (res.session_id) setSessionId(res.session_id)
      setStep(STEPS.SUMMARY)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGetSummary = async () => {
    const problem = (transcript || typedProblem || '').trim()
    if (!problem) return
    setLoading(true)
    setError(null)
    try {
      const res = await getCaseSummary(sessionId, problem)
      setCaseSummary(res.case_summary)
      setRagChunks(res.rag_chunks || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGenerateScript = async (userProblem = null) => {
    const problem = userProblem ?? transcript ?? typedProblem
    if (!caseSummary || !problem) return
    setLoading(true)
    setError(null)
    try {
      const res = await generateScript(sessionId, problem, caseSummary)
      setScript(res.script)
      setFullScript(res.script?.full_script || JSON.stringify(res.script, null, 2))
      setStep(STEPS.SCRIPT)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleApproveScript = async () => {
    setLoading(true)
    setError(null)
    try {
      await approveScript(sessionId, fullScript)
      setStep(STEPS.CALL)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleStartCall = async () => {
    setLoading(true)
    setError(null)
    try {
      await startCall(sessionId, fullScript, transcript || typedProblem)
      const url = getCallWebSocketUrl(sessionId)
      const socket = new WebSocket(url)
      socket.onopen = () => {
        setCallActive(true)
        setCallTranscript([])
      }
      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'response') {
          setCallTranscript(prev => [...prev, { role: 'customer', text: msg.text, latency: msg.latency_ms }])
          const vid = voiceId || 'EXAVITQu4vr4xnSDxMaL'
          if (msg.text) {
            getTTS(msg.text, vid).then(({ audio_base64 }) => {
              const audio = new Audio(`data:audio/mp3;base64,${audio_base64}`)
              audio.play()
            })
          }
        }
      }
      socket.onerror = () => setError('WebSocket error')
      setWs(socket)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const sendAgentMessage = () => {
    if (!agentInput.trim() || !ws || ws.readyState !== WebSocket.OPEN) return
    const msg = agentInput.trim()
    setAgentInput('')
    setCallTranscript(prev => [...prev, { role: 'agent', text: msg }])
    ws.send(JSON.stringify({ type: 'agent_speech', text: msg }))
  }

  const handleEndCall = () => {
    if (ws) {
      ws.send(JSON.stringify({ type: 'end_call' }))
      ws.close()
    }
    setWs(null)
    setCallActive(false)
  }

  return (
    <div className="app">
      <header>
        <h1>Insurance Voice Assistant</h1>
        <p>Upload your policy, record your voice, and let AI negotiate on your behalf</p>
      </header>

      {error && (
        <div className="error">{error}</div>
      )}

      <div className="flow">
        {/* Step 1: Upload document */}
        <section className={`card ${step >= STEPS.UPLOAD ? 'active' : ''}`}>
          <h2>1. Upload Policy Document</h2>
          <input
            type="file"
            accept=".pdf"
            onChange={handleDocumentUpload}
            disabled={loading}
          />
          {sessionId && <p className="success">✓ Document ingested (session: {sessionId.slice(0, 8)}...)</p>}
        </section>

        {/* Step 2: Record voice */}
        {step >= STEPS.VOICE && (
          <section className={`card ${step >= STEPS.VOICE ? 'active' : ''}`}>
            <h2>2. Record Your Voice (or Skip)</h2>
            <p>Record at least 30 seconds describing your insurance problem, or skip to type below.</p>
            <div className="voice-controls">
              {!recording ? (
                <button onClick={startVoiceRecord} disabled={loading}>Start Recording</button>
              ) : (
                <button onClick={stopVoiceRecord} className="stop">Stop Recording</button>
              )}
              <span> or </span>
              <label className="upload-btn">
                Upload audio file
                <input type="file" accept=".mp3,.wav,.webm,.m4a,.ogg" onChange={handleVoiceFileUpload} hidden />
              </label>
              <span> or </span>
              <button type="button" onClick={() => setStep(STEPS.SUMMARY)} className="skip">
                Skip (type problem in next step)
              </button>
            </div>
            {transcript && (
              <div className="transcript-preview">
                <strong>Your problem (transcribed):</strong>
                <p>{transcript}</p>
              </div>
            )}
          </section>
        )}

        {/* Step 3: Case summary */}
        {step >= STEPS.SUMMARY && (
          <section className={`card ${step >= STEPS.SUMMARY ? 'active' : ''}`}>
            <h2>3. Case Summary</h2>
            {!transcript && (
              <div className="typed-problem">
                <p>Or type your problem (if you skipped voice):</p>
                <input
                  type="text"
                  value={typedProblem}
                  onChange={(e) => setTypedProblem(e.target.value)}
                  placeholder="e.g. They denied my claim for hospital stay, policy 12345"
                />
              </div>
            )}
            <button onClick={handleGetSummary} disabled={loading || !(transcript || typedProblem)}>
              {loading ? 'Loading...' : 'Get Case Summary'}
            </button>
            {ragChunks.length > 0 && (
              <div className="chunks">
                <strong>Relevant policy excerpts ({ragChunks.length}):</strong>
                {ragChunks.slice(0, 3).map((c, i) => (
                  <blockquote key={i}>{c.slice(0, 200)}...</blockquote>
                ))}
              </div>
            )}
            {caseSummary && (
              <div className="summary">
                <strong>Case Summary:</strong>
                <pre>{JSON.stringify(caseSummary, null, 2)}</pre>
              </div>
            )}
            {caseSummary && (
              <>
                <button onClick={() => handleGenerateScript(transcript || typedProblem)} disabled={loading}>
                  {loading ? 'Generating...' : 'Generate Negotiation Script'}
                </button>
              </>
            )}
          </section>
        )}

        {/* Step 4: Script review (HITL) */}
        {script && (
          <section className={`card ${step >= STEPS.SCRIPT ? 'active' : ''}`}>
            <h2>4. Review & Approve Script</h2>
            <p>Edit if needed, then approve before the call.</p>
            <textarea
              value={fullScript}
              onChange={(e) => setFullScript(e.target.value)}
              rows={12}
              placeholder="Negotiation script..."
            />
            <button onClick={handleApproveScript} disabled={loading}>
              {loading ? 'Approving...' : 'Approve & Start Call'}
            </button>
          </section>
        )}

        {/* Step 5: Live call */}
        {step >= STEPS.CALL && (
          <section className={`card ${step >= STEPS.CALL ? 'active' : ''}`}>
            <h2>5. Live Call (Simulation)</h2>
            <p>For demo: Teammate plays the insurance agent. Type their response below.</p>
            {!callActive ? (
              <button onClick={handleStartCall} disabled={loading}>
                {loading ? 'Starting...' : 'Start Call'}
              </button>
            ) : (
              <>
                <div className="call-transcript">
                  {callTranscript.map((t, i) => (
                    <div key={i} className={`turn ${t.role}`}>
                      <strong>{t.role === 'agent' ? 'Agent' : 'You (AI)'}:</strong> {t.text}
                      {t.latency && <span className="latency"> ({t.latency.toFixed(0)}ms)</span>}
                    </div>
                  ))}
                </div>
                <div className="agent-input">
                  <input
                    value={agentInput}
                    onChange={(e) => setAgentInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendAgentMessage()}
                    placeholder="Type what the agent says..."
                  />
                  <button onClick={sendAgentMessage}>Send</button>
                </div>
                <button onClick={handleEndCall} className="end">End Call</button>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

export default App
