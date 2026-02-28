/** API client for Insurance Voice Assistant backend */

const API = '/api';

export async function uploadDocument(file, sessionId = null) {
  const form = new FormData();
  form.append('file', file);
  if (sessionId) form.append('session_id', sessionId);
  const r = await fetch(`${API}/upload/document`, {
    method: 'POST',
    body: form,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function uploadVoice(file, sessionId = null) {
  const form = new FormData();
  form.append('file', file);
  if (sessionId) form.append('session_id', sessionId);
  const r = await fetch(`${API}/voice/record`, {
    method: 'POST',
    body: form,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getCaseSummary(sessionId, userProblem) {
  const r = await fetch(`${API}/rag/case-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, user_problem: userProblem }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function generateScript(sessionId, userProblem, caseSummary) {
  const r = await fetch(`${API}/script/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, user_problem: userProblem, case_summary: caseSummary }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function approveScript(sessionId, fullScript, edits = null) {
  const r = await fetch(`${API}/script/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      approved: true,
      edits: edits ?? null,
      full_script: fullScript,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function startCall(sessionId, script, userProblem) {
  const r = await fetch(`${API}/call/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, script, user_problem: userProblem }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function getTTS(text, voiceId) {
  const r = await fetch(`${API}/call/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voiceId }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export function getCallWebSocketUrl(sessionId) {
  const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  return `${wsProto}//${host}/ws/call/${sessionId}`;
}
