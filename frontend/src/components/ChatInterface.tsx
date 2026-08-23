import { useState, useEffect, useRef, useCallback } from 'react';
import type { CaseData, ChatMessage, Flowchart, FlowNode, FlowEdge } from '../types';
import { API_BASE, fetchFlowchart, startChatSession, getChatHistory, sendChatMessage } from '../api/caseApi';

// Strip all markdown and internal citation markers from displayed text
function clean(t: string): string {
  return t
    .replace(/\*\*/g, '').replace(/\*/g, '').replace(/__/g, '').replace(/_/g, '').replace(/`/g, '')
    .replace(/\[D\d+\]/g, '')
    .replace(/\[F\d+\]/g, '')
    .replace(/\[C\d+\]/g, '')
    .replace(/\[S\d+\]/g, '')
    .replace(/\[A\d+\]/g, '')
    .replace(/\[edge-[^\]]+\]/g, '')
    .replace(/\[framework-node\]/g, '')
    .replace(/\[quant-node\]/g, '')
    .replace(/\[rec-node\]/g, '')
    .replace(/\[stuck\]/g, '')
    .replace(/• /g, '')
    // Catch orphaned phrases left after citation stripping
    // 1. "such as [D2] and" → "such as and" → remove
    .replace(/\b(such\s+as)\s+and\b/gi, '')
    .replace(/\b(such\s+as)\s+([.,;!?)\]])/gi, '$2')
    // 2. "stated in and" → after [D3] stripped → remove
    .replace(/\b(as\s+stated\s+in|as\s+noted\s+in|as\s+shown\s+in|as\s+mentioned\s+in|as\s+cited\s+in|as\s+described\s+in)\s+and\b/gi, '')
    .replace(/\b(described\s+in|stated\s+in|shown\s+in|mentioned\s+in|outlined\s+in|noted\s+in|defined\s+in|detailed\s+in|cited\s+in|listed\s+in)\s+and\b/gi, '')
    // 3. "highlighted in and", "indicated by and", "displayed at and"
    .replace(/\b(highlighted|indicated|displayed|referred|hinted)\s+(in|at|by)\s+and\b/gi, '')
    // 4. "as per and", "according to and"
    .replace(/\b(as\s+per|according\s+to)\s+and\b/gi, '')
    // 5. Orphaned "and" before punctuation: "such as and .", "in and ."
    .replace(/\band\s+([.,;!?)\]])/g, '$1')
    .replace(/\band\s+$/gm, '')
    // 6. Orphaned phrases before punctuation
    .replace(/\b(as\s+per|according\s+to|hinted\s+at\s+by\s*|referred\s+to\s*|displayed\s+at\s*|indicated\s+by|highlighted\s+by|supported\s+by)\s+([.,;!?)\]])/gi, '$2')
    .replace(/\b(described\s+in|stated\s+in|shown\s+in|mentioned\s+in|outlined\s+in|noted\s+in|defined\s+in|detailed\s+in|cited\s+in|listed\s+in)\s+([.,;!?)\]])/gi, '$2')
    .replace(/\b(a|an|the|this|that)\s+([.,;!?)\]])/gi, '$2')
    .replace(/\b(in|at|by|to)\s+([.,;!?)\]])/g, '$2')
    .replace(/\b(as)\s+([.,;!?)\]])/gi, '$2')
    .replace(/\b(in|at|by|to)\s+([.,;!?)\]])/g, '$2')
    .replace(/\b(in|at|by|to)\s+$/gm, '')
    // Remove leading stray punctuation that ended up at start of line after stripping
    .replace(/^[.,;!?\s]+/, '')
    // Remove trailing "as " left behind
    .replace(/\bas\s+$/gm, '')
    .replace(/\bsuch\s+as\s+(those|these)\s+/gi, 'such as $1 ')
    // "as . X" → ". X", "such as . X" → ". X"
    .replace(/\b(such\s+as|as)\s+\.\s+/gi, '. ')
    // "as ," → ""
    .replace(/\bas\s+,/gi, '')
    // ".price" → "price" (period at start of word after stripping)
    .replace(/\.(\w)/g, '. $1')
    // ", ." → "."
    .replace(/, \./g, '.')
    .replace(/\. ,/g, '.')
    .replace(/\s{2,}/g, ' ')
    .replace(/([.,;!?])\1{2,}/g, '$1$1')
    .replace(/ ,,/g, ',')
    .replace(/, ,/g, ',')
    .replace(/\b(such\s+as)\s*$/gm, '')
    .replace(/\b(as|in|at|by|to)\s+$/gm, '')
    .replace(/\b(as|in|at|by|to)\s+([.,;!?)\]])/gi, '$2')
    .trim();
}

interface ChatInterfaceProps {
  caseData: CaseData;
  userRole: 'interviewee' | 'interviewer';
  difficulty: string;
  onBack: () => void;
  onFinish: (messages: ChatMessage[], elapsed: number) => void;
  onSessionCreated?: (sessionId: string) => void;
}

// ─── Inline Mini Flowchart Component ───

function MiniFlowchart({ nodes, edges }: { nodes: FlowNode[]; edges: FlowEdge[] }) {
  if (!nodes || nodes.length === 0) {
    return <div className="flowchart-empty">Start the conversation to build your case flowchart</div>;
  }

  const nodeColors: Record<string, string> = {
    problem: '#6366f1',
    hypothesis: '#a855f7',
    exploration: '#0ea5e9',
    analysis: '#f59e0b',
    insight: '#22c55e',
    recommendation: '#14b8a6',
    'dead-end': '#ef4444'
  };

  return (
    <div className="mini-flowchart">
      {nodes.map((node, i) => {
        const incomingEdges = edges.filter(e => e.target === node.id);
        const outgoingEdges = edges.filter(e => e.source === node.id);
        const color = nodeColors[node.type] || '#6366f1';

        return (
          <div key={node.id} className="flowchart-node-wrapper" style={{ animationDelay: '${i * 100}ms' }}>
            {incomingEdges.length > 0 && (
              <div className="flowchart-edge-label">
                {incomingEdges.map(e => (
                  <span key={e.id} className="edge-label">{clean(e.label)}</span>
                ))}
              </div>
            )}
            <div className="flowchart-node" style={{ borderColor: color, backgroundColor: '${color}15' }}>
              <div className="flowchart-node-icon">
                {node.type === 'problem' ? '' : node.type === 'analysis' ? '' : node.type === 'insight' ? '' : node.type === 'recommendation' ? '' : ⚠️}
              </div>
              <span className="flowchart-node-label">{clean(node.label)}</span>
            </div>
            {outgoingEdges.length > 0 && (
              <div className="flowchart-connector">
                <svg width="16" height="24" viewBox="0 0 16 24">
                  <path d="M8 0v20M1 13l7 7 7-7" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="2" />
                </svg>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
// ─── Main ChatInterface ───

export default function ChatInterface({ caseData, userRole, difficulty, onBack, onFinish, onSessionCreated }: ChatInterfaceProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [timeElapsed, setTimeElapsed] = useState(0);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [flowchart, setFlowchart] = useState<Flowchart | null>(null);
  const [showFlowchart, setShowFlowchart] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasInitRef = useRef<boolean>(false);
  const flowIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!hasInitRef.current) {
      hasInitRef.current = true;
      initSession();
    }
    timerRef.current = setInterval(() => {
      setTimeElapsed((t) => t + 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (flowIntervalRef.current) clearInterval(flowIntervalRef.current);
    };
  }, []);
  // Keep outermost page scroll at top while chatting
  useEffect(() => { window.scrollTo(0, 0); }, []);

  // Auto-scroll: scroll WITHIN the chat container using scrollTop, show the TOP so user can read from the start
  const prevMessagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    if (messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    const prevLast = prevMessagesRef.current[prevMessagesRef.current.length - 1];
    if (lastMsg.timestamp === prevLast?.timestamp) return;
    
    const container = chatMessagesRef.current;
    if (!container) return;
    const timer = setTimeout(() => {
      // For long assistant messages, scroll within container to message top
      if (lastMsg.role === 'assistant' && lastMsg.content.length > 300) {
        // Find the assistant message element and scroll its top into view
        const msgElements = container.querySelectorAll('.message.assistant');
        const lastAssistant = msgElements[msgElements.length - 1] as HTMLElement | undefined;
        if (lastAssistant) {
          container.scrollTop = lastAssistant.offsetTop - container.offsetTop - 80;
        } else {
          container.scrollTop = container.scrollHeight;
        }
      } else {
        // Normal scroll to bottom for short messages and user messages
        container.scrollTop = container.scrollHeight;
      }
    }, lastMsg.role === 'assistant' ? 350 : 150);
    prevMessagesRef.current = messages;
    return () => clearTimeout(timer);
  }, [messages]);

  // Poll flowchart periodically
  useEffect(() => {
    if (sessionId) {
      loadFlowchart();
      flowIntervalRef.current = setInterval(loadFlowchart, 5000);
    }
    return () => {
      if (flowIntervalRef.current) clearInterval(flowIntervalRef.current);
    };
  }, [sessionId]);

  async function loadFlowchart() {
    if (!sessionId) return;
    try {
      const data = await fetchFlowchart(sessionId);
      setFlowchart(data);
    } catch { /* ignore polling errors */ }
  }

  async function initSession(retries = 2) {
    try {
      // First check backend is reachable (via Vite proxy to avoid CORS)
      await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
      
      const result = await Promise.race([
        startChatSession(caseData.id, userRole, difficulty),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out waiting for AI')), 65000))
      ]) as { sessionId: string };
      setSessionId(result.sessionId);
      if (onSessionCreated) onSessionCreated(result.sessionId);
      const history = await getChatHistory(result.sessionId);
      if (history.messages && history.messages.length > 0) {
        setMessages(history.messages.map((m) => ({ ...m, timestamp: Date.now() })));
      }
      setSessionError(null);
    } catch {
      if (retries > 0) {
        setTimeout(() => initSession(retries - 1), 2000);
        return;
      }
      setSessionError('Connection failed: The AI service did not respond within the time limit. Please ensure the backend is running and try again.');
    }
  }

  async function sendMessage() {
    if (!input.trim() || sending || !sessionId) return;

    const userMsg = input.trim();
    const lower = userMsg.toLowerCase();

    // Detect if user wants to end/finish the session via chat
    const endPatterns = [
      /\b(end|finish|done|stop|quit|exit)\b/i,
      /\b(that'?s all|that'?s it|that'?s enough|i'?m done|i am done|i'?m finished|i am finished|wrap up|wind up)\b/i,
      /\b(conclude|summarize|close this)\b/i,
      /\b(results|score|evaluation|summary)\b.*\b(show|see|give|want|view|look)\b/i,
      /\b(show|see|give|want|view)\b.*\b(results|score|evaluation|summary)\b/i,
    ];
    const matchEnd = endPatterns.some(p => p.test(lower));

    if (matchEnd) {
      setInput('');
      setShowEndConfirm(true);
      return;
    }

    setInput('');
    setSending(true);

    const userMessage: ChatMessage = {
      role: 'user',
      content: userMsg,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const result = await sendChatMessage(sessionId, caseData.id, userRole, difficulty, userMsg);
      const aiMessage: ChatMessage = {
        role: 'assistant',
        content: result.reply,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch {
      const errMsg: ChatMessage = {
        role: 'assistant',
        content: 'I apologize, but I encountered an error while processing your request. Please try again.',
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [input, sending, sessionId]);

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  const [showEndConfirm, setShowEndConfirm] = useState(false);

  function handleEndSession() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (flowIntervalRef.current) clearInterval(flowIntervalRef.current);
    onFinish(messages, timeElapsed);
  }

  return (
    <div className="chat-interface">
      {/* Top Bar */}
      <div className="chat-topbar">
        <div className="topbar-left">
          <button className="back-btn" onClick={onBack}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Exit
          </button>
          <div className="topbar-info">
            <span className="topbar-title">{caseData.title}</span>
            <span className="topbar-meta">
              {userRole === 'interviewee' ? '👨‍💼 Interviewee' : '👩‍💼 Interviewer'} · {difficulty}
            </span>
          </div>
        </div>
        <div className="topbar-right">
          <div className="timer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
            </svg>
            {formatTime(timeElapsed)}
          </div>
          <button className="topbar-btn" onClick={() => setShowFlowchart(!showFlowchart)} title="Case Flowchart">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </button>
          <button className="topbar-btn" onClick={() => setShowNotes(!showNotes)} title="Notes">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>
          <button className="topbar-btn end-session" onClick={() => setShowEndConfirm(true)} title="End Session">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="9" y1="9" x2="15" y2="15" /><line x1="15" y1="9" x2="9" y2="15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="chat-panels">
        {/* Left Panel: Persistent Data & Hints */}
        <div className="chat-sidebar">
          {/* Case Info Section */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span className="sidebar-icon">📋</span>
              <span>Case Prompt</span>
            </div>
            <div className="sidebar-content">
              <p className="sidebar-prompt">{clean(caseData.prompt)}</p>
            </div>
          </div>

          {/* Context Section */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span className="sidebar-icon">📖</span>
              <span>Context</span>
            </div>
            <div className="sidebar-content">
              <p className="sidebar-context">{clean(caseData.context)}</p>
            </div>
          </div>

          {/* Key Facts Section - ALWAYS VISIBLE */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span className="sidebar-icon">🔑</span>
              <span>Key Facts & Data</span>
              <span className="sidebar-badge">{caseData.keyFacts.length}</span>
            </div>
            <div className="sidebar-content">
              <ul className="sidebar-facts">
                {caseData.keyFacts.map((fact, i) => (
                  <li key={i}>
                    <span className="fact-dot" />
                    <span>{clean(fact)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Framework Hints Section - ALWAYS VISIBLE */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span className="sidebar-icon">💡</span>
              <span>Framework Hints</span>
            </div>
            <div className="sidebar-content">
              <ul className="sidebar-hints">
                {caseData.frameworkHints.map((hint, i) => (
                  <li key={i}>
                    <span className="hint-num">{i + 1}</span>
                    <span>{clean(hint)}</span>
                  </li>
                ))}
              </ul>
              {caseData.expectedCalculations && caseData.expectedCalculations.length > 0 && (
                <>
                  <div className="sidebar-subheader">Expected Calculations</div>
                  <ul className="sidebar-hints">
                    {caseData.expectedCalculations.map((calc, i) => (
                      <li key={i}>
                        <span className="hint-num calc">∑</span>
                        <span>{calc}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>

          {/* Success Criteria */}
          <div className="sidebar-section">
            <div className="sidebar-section-header">
              <span className="sidebar-icon">🎯</span>
              <span>Success Criteria</span>
            </div>
            <div className="sidebar-content">
              <ul className="sidebar-hints">
                {caseData.successCriteria.map((crit, i) => (
                  <li key={i}>
                    <span className="hint-num">{i + 1}</span>
                    <span>{clean(crit)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Center: Chat Area */}
      <div className="chat-main">
        <div className="chat-messages" ref={chatMessagesRef}>
          {messages.length === 0 && !sessionError ? (
            <div className="chat-welcome">
              <div className="welcome-spinner" />
              <p>Starting your case session...</p>
            </div>
          ) : messages.length === 0 && sessionError ? (
            <div className="chat-welcome" style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
              <p style={{ color: 'var(--warning)', marginBottom: 16 }}>{sessionError}</p>
              <button className="btn-primary" onClick={() => initSession()} style={{ marginTop: 8 }}>
                Retry Connection
              </button>
            </div>
          ) : (
              messages.map((msg, i) => (
                <div key={i} className={`message ${msg.role === 'user' ? 'user' : 'assistant'}`}>
                  <div className="message-avatar">
                    {msg.role === 'user' ? '👤' : userRole === 'interviewee' ? '👨‍💼' : '👩‍💼'}
                  </div>
                  <div className="message-content">
                    <div className="message-sender">
                      {msg.role === 'user' ? 'You' : userRole === 'interviewee' ? 'Interviewer (AI)' : 'Candidate (AI)'}
                    </div>
                    <div className="message-text">
                      {msg.content.split('\n').map((line, j) => (
                        <p key={j}>{clean(line)}</p>
                      ))}
                    </div>
                    <div className="message-time">
                      {new Date(msg.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}
            {sending && (
              <div className="message assistant">
                <div className="message-avatar">{userRole === 'interviewee' ? '👨‍💼' : '👩‍💼'}</div>
                <div className="message-content">
                  <div className="typing-indicator">
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-area">
            <div className="chat-input-wrapper">
              <textarea
                ref={inputRef}
                className="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={userRole === 'interviewee' ? 'Type your answer, ask for data, or present your framework...' : 'Ask a question, challenge the candidate, or provide feedback...'}
                rows={2}
                disabled={sending}
              />
              <button
                className="send-btn"
                onClick={sendMessage}
                disabled={!input.trim() || sending}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
            <div className="chat-input-hint">
              Press Enter to send · Shift+Enter for new line
            </div>
          </div>
        </div>

        {/* Right Panel: Flowchart / Notes */}
        {/* End Session Confirmation Modal */}
        {showEndConfirm && (
          <div className="modal-overlay" onClick={() => setShowEndConfirm(false)}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
              <h3>End Interview Session?</h3>
              <p>Your conversation will be evaluated and you'll receive a detailed score report.</p>
              <div className="modal-actions">
                <button className="btn-primary" onClick={handleEndSession}>
                  End & See Results
                </button>
                <button className="btn-secondary" onClick={() => setShowEndConfirm(false)}>
                  Continue Interview
                </button>
              </div>
            </div>
          </div>
        )}

        {(showFlowchart || showNotes) && (
          <div className="chat-right-panel">
            {showFlowchart && (
              <div className="panel flowchart-panel">
                <div className="panel-header">
                  <h3>📊 Case Flowchart</h3>
                  <button onClick={() => setShowFlowchart(false)}>✕</button>
                </div>
                <div className="panel-body">
                  <MiniFlowchart nodes={flowchart?.nodes || []} edges={flowchart?.edges || []} />
                  <p className="flowchart-hint">
                    This chart updates as your conversation progresses. Each node represents a step in your analysis.
                  </p>
                </div>
              </div>
            )}
            {showNotes && (
              <div className="panel notes-panel">
                <div className="panel-header">
                  <h3>📝 Your Notes</h3>
                  <button onClick={() => setShowNotes(false)}>✕</button>
                </div>
                <div className="panel-body">
                  <textarea
                    className="notes-input"
                    placeholder="Jot down your thoughts, calculations, framework ideas..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}




