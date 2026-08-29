import { useEffect, useState, useMemo } from 'react';
import ReactFlow, { Background, Controls, ReactFlowProvider, getBezierPath, BaseEdge, EdgeLabelRenderer, Handle, Position } from 'reactflow';
import 'reactflow/dist/style.css';
import type { CaseData, ChatMessage, FlowNode, FlowEdge } from '../types';
import { evaluateConversation } from '../api/caseApi';

interface ResultsScreenProps {
  caseData: CaseData;
  userRole: 'interviewee' | 'interviewer';
  difficulty: string;
  messages: ChatMessage[];
  timeElapsed: number;
  flowchart?: { nodes: FlowNode[]; edges: FlowEdge[] } | null;
  onRestart: () => void;
  onNewCase: () => void;
}

interface ScoreSet {
  overall: number;
  structure: { score: number; feedback: string; evidence: string };
  analysis: { score: number; feedback: string; evidence: string };
  recommendations: { score: number; feedback: string; evidence: string };
  communication: { score: number; feedback: string; evidence: string };
  strengths: string[];
  improvements: string[];
  summary: string;
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

const stageMeta: Record<string, { icon: string; label: string }> = {
  problem: { icon: '🎯', label: 'Problem Definition' },
  hypothesis: { icon: '💡', label: 'Hypothesis' },
  exploration: { icon: '🔍', label: 'Exploration' },
  analysis: { icon: '📊', label: 'Analysis' },
  insight: { icon: '✨', label: 'Insight' },
  recommendation: { icon: '🏁', label: 'Recommendation' },
  'dead-end': { icon: '⚠️', label: 'Dead End' }
};

// ─── Custom ReactFlow node: stage icon + label + thought process + depth dots ───
function ThoughtNode({ data }: { data: { label: string; nodeType: string; thoughtProcess?: string; depth?: number } }) {
  const color = nodeColors[data.nodeType] || '#6366f1';
  const meta = stageMeta[data.nodeType] || { icon: '•', label: '' };
  const depth = data.depth ?? 0;

  return (
    <div style={{
      border: `1.5px solid ${color}66`,
      background: `linear-gradient(135deg, ${color}14, ${color}06)`,
      borderRadius: 12,
      padding: '10px 14px',
      minWidth: 200,
      maxWidth: 260,
    }}>
      {/* Handles are REQUIRED for edges to attach to custom nodes — hidden visually.
          Left/Right placement gives a clean left-to-right flowchart flow. */}
      <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 6, height: 6 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 9,
          background: `${color}22`, border: `1px solid ${color}88`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, flexShrink: 0,
        }}>
          {meta.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color }}>
            {meta.label}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {data.label}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          {Array.from({ length: Math.min(5, Math.max(1, depth + 1)) }).map((_, d) => (
            <span key={d} style={{
              width: 6, height: 6, borderRadius: '50%',
              background: d <= Math.min(4, depth) ? color : 'rgba(255,255,255,0.12)',
            }} />
          ))}
        </div>
      </div>
      {data.thoughtProcess && (
        <p style={{ margin: '7px 0 0', fontSize: 11, lineHeight: 1.45, color: 'rgba(255,255,255,0.55)' }}>
          💭 {data.thoughtProcess}
        </p>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 6, height: 6 }} />
    </div>
  );
}

const flowNodeTypes = { thought: ThoughtNode };

// Custom edge that draws an explicit, always-visible arrowhead at the target end.
// (Built-in markerEnd SVG defs were not rendering reliably, so we draw the triangle ourselves.)
const flowEdgeTypes = {
  arrow: ({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, label }: any) => {
    // Rounded bezier curve for a smooth, organic look
    const [path, labelX, labelY, offsetX, offsetY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.4 });
    // Orient the arrowhead along the curve's end tangent (offsetX/offsetY)
    const len = Math.hypot(offsetX, offsetY) || 1;
    const ux = offsetX / len;
    const uy = offsetY / len;
    const px = -uy;
    const py = ux;
    const size = 9;
    const tipX = targetX - ux * 3;
    const tipY = targetY - uy * 3;
    const bX = tipX - ux * size + px * size * 0.6;
    const bY = tipY - uy * size + py * size * 0.6;
    const cX = tipX - ux * size - px * size * 0.6;
    const cY = tipY - uy * size - py * size * 0.6;
    return (
      <>
        <BaseEdge path={path} style={style} />
        <polygon points={`${tipX},${tipY} ${bX},${bY} ${cX},${cY}`} fill="#e2e8f0" />
        {label ? (
          <EdgeLabelRenderer>
            <div
              className="nodrag nopan"
              style={{
                position: 'absolute',
                // Offset the label ABOVE the edge midpoint so it never covers node text
                transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY - 6}px)`,
                background: 'rgba(8, 8, 14, 0.85)',
                border: '1px solid rgba(148,163,184,0.25)',
                color: 'rgba(255,255,255,0.6)',
                padding: '1px 6px',
                borderRadius: 5,
                fontSize: 9,
                zIndex: 4,
                maxWidth: 160,
                pointerEvents: 'none' as const,
                // Wrap onto multiple lines instead of ellipsis so text never overlaps
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                lineHeight: 1.3,
                textAlign: 'center',
              }}
            >
              {label}
            </div>
          </EdgeLabelRenderer>
        ) : null}
      </>
    );
  },
};

function ensurePositions(nodes: FlowNode[], edges: FlowEdge[] = []) {
  // GOLDEN-ANGLE SPIRAL layout for a true 2D bird's-eye view: the root sits at
  // the center and every other node spirals outward, filling the viewport
  // compactly in both dimensions — no long lines, no scrolling.
  const idSet = new Set(nodes.map(n => n.id));
  const parents = new Map<string, string[]>();
  nodes.forEach(n => parents.set(n.id, []));
  edges.forEach(e => {
    if (idSet.has(e.source) && idSet.has(e.target)) parents.get(e.target)!.push(e.source);
  });

  // Longest-path layering so we can order the spiral by reasoning depth
  const layerOf = new Map<string, number>();
  const visiting = new Set<string>();
  const computeLayer = (id: string): number => {
    const cached = layerOf.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    const ps = parents.get(id) || [];
    const d = ps.length ? Math.max(...ps.map(computeLayer)) + 1 : 0;
    visiting.delete(id);
    layerOf.set(id, d);
    return d;
  };
  nodes.forEach(n => computeLayer(n.id));

  // Sort by depth so the spiral grows outward from the problem
  const sorted = [...nodes].sort((a, b) => (layerOf.get(a.id) || 0) - (layerOf.get(b.id) || 0));

  const pos = new Map<string, { x: number; y: number }>();
  const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~2.399 rad
  const SPACING = 95;

  sorted.forEach((n, i) => {
    if (i === 0) {
      pos.set(n.id, { x: 0, y: 0 });
      return;
    }
    const radius = SPACING * Math.sqrt(i);
    const angle = i * goldenAngle;
    pos.set(n.id, {
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    });
  });

  // Normalize so the cluster is centered and fits a ~600px box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach(n => {
    const p = pos.get(n.id)!;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  });
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const scale = 300 / Math.max(1, Math.max(maxX - minX, maxY - minY));

  return nodes.map(node => {
    if (node.position && typeof node.position.x === 'number' && typeof node.position.y === 'number') {
      return node;
    }
    const p = pos.get(node.id)!;
    return { ...node, position: { x: (p.x - cx) * scale, y: (p.y - cy) * scale } };
  });
}

// ─── Spider/Radar Chart with 5 dimensions ───
function SpiderChart({ scores, labels }: { scores: number[]; labels: string[] }) {
  const cx = 100, cy = 100, radius = 72;
  const n = scores.length;
  const toPoint = (i: number, r: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };

  return (
    <svg viewBox="0 0 200 200" className="spider-chart" style={{ width: 220, height: 220, overflow: 'visible' }}>
      {/* Grid rings */}
      {[0.2, 0.4, 0.6, 0.8, 1.0].map((pct, i) => (
        <polygon
          key={i}
          points={Array.from({ length: n }, (_, j) => {
            const p = toPoint(j, radius * pct);
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
          }).join(' ')}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="1"
        />
      ))}
      {/* Axes */}
      {Array.from({ length: n }, (_, j) => {
        const p = toPoint(j, radius + 6);
        return <line key={j} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />;
      })}
      {/* Data polygon */}
      <polygon
        points={Array.from({ length: n }, (_, j) => {
          const p = toPoint(j, Math.max((scores[j] || 0) / 100 * radius, 4));
          return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        }).join(' ')}
        fill="rgba(108,92,231,0.18)"
        stroke="#6c5ce7"
        strokeWidth="2"
      />
      {/* Data points */}
      {scores.map((score, j) => {
        const p = toPoint(j, Math.max(score / 100 * radius, 4));
        return <circle key={j} cx={p.x} cy={p.y} r="3.5" fill="#6c5ce7" stroke="#a29bfe" strokeWidth="1.5" />;
      })}
      {/* Labels */}
      {labels.map((label, j) => {
        const p = toPoint(j, radius + 20);
        const a = (j / n) * Math.PI * 2 - Math.PI / 2;
        let anchor: 'start' | 'middle' | 'end' = 'middle';
        if (a > Math.PI / 2 + 0.1 || a < -Math.PI / 2 - 0.1) anchor = 'end';
        else if (a > 0.1 || a < -0.1) anchor = 'start';
        return (
          <g key={j}>
            <text x={p.x} y={p.y - 1} textAnchor={anchor} fill="var(--text-secondary)" fontSize="9" fontWeight="500">{label}</text>
            <text x={p.x} y={p.y + 11} textAnchor={anchor} fill="#a29bfe" fontSize="9" fontWeight="700">{scores[j]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function ResultsScreen({
  caseData,
  userRole,
  difficulty,
  messages,
  timeElapsed,
  flowchart,
  onRestart,
  onNewCase,
}: ResultsScreenProps) {
  const [scores, setScores] = useState<ScoreSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function evaluate() {
      try {
        setLoading(true);
        const chatMessages = messages.map(m => ({ role: m.role, content: m.content }));
        const result = await evaluateConversation(caseData, userRole, difficulty, chatMessages);
        setScores(result.scores);
      } catch (err) {
        console.error('Failed to evaluate conversation:', err);
        setError('Could not load AI evaluation. Showing estimated scores.');
        setScores(heuristicScore(caseData, userRole, difficulty, messages));
      } finally {
        setLoading(false);
      }
    }
    evaluate();
  }, []);

  const getScoreColor = (score: number) => {
    if (score >= 85) return '#22c55e';
    if (score >= 70) return '#3b82f6';
    if (score >= 55) return '#f59e0b';
    if (score >= 40) return '#ef4444';
    return '#6b7280';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 90) return 'Exceptional';
    if (score >= 75) return 'Strong';
    if (score >= 60) return 'Solid';
    if (score >= 40) return 'Developing';
    return 'Needs Work';
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const reactFlowNodes = useMemo(() => {
    if (!flowchart || !flowchart.nodes || flowchart.nodes.length === 0) return [];
    return ensurePositions(flowchart.nodes, flowchart.edges).map(node => ({
      id: node.id,
      position: node.position || { x: 0, y: 0 },
      type: 'thought' as const,
      data: {
        label: node.label,
        nodeType: node.type,
        thoughtProcess: node.thoughtProcess,
        depth: node.depth,
      },
    }));
  }, [flowchart]);

  const reactFlowEdges = useMemo(() => {
    if (!flowchart || !flowchart.edges) return [];
    return flowchart.edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'arrow',
      label: edge.reasoning || edge.label,
      animated: true,
      style: { stroke: '#94a3b8', strokeWidth: 2.5 },
    }));
  }, [flowchart]);

  if (loading) {
    return (
      <div className="results-page">
        <div className="results-container">
          <div className="loading-container">
            <div className="loader" />
            <p>Evaluating your case performance...</p>
          </div>
        </div>
      </div>
    );
  }

  const displayScores = scores || heuristicScore(caseData, userRole, difficulty, messages);
  const totalExchanges = messages.filter(m => m.role === 'user').length;

  // Derive 5th dimension: "Hypothesis-Driven" from conversation patterns
  const userText = messages.filter(m => m.role === 'user').map(m => m.content.toLowerCase()).join(' ');
  const hasHypothesis = /hypothesis|i think|i believe|my hypothesis|i suspect/.test(userText);
  const hypothesisScore = hasHypothesis
    ? Math.min(95, displayScores.structure.score + 5)
    : Math.max(30, displayScores.structure.score - 10);

  const spiderScores = [displayScores.structure.score, displayScores.analysis.score, displayScores.recommendations.score, displayScores.communication.score, hypothesisScore];
  const spiderLabels = ['Structure', 'Analysis', 'Recomm.', 'Comm.', 'Hypothesis'];

  return (
    <div className="results-page">
      <div className="results-container">
        <div className="results-header">
          <div className="results-badge">Session Complete</div>
          <h2>Performance Summary</h2>
          <p className="results-subtitle">{caseData.title} · {difficulty} · {userRole === 'interviewee' ? 'Interviewee' : 'Interviewer'}</p>
          {error && <p className="results-subtitle" style={{ color: 'var(--warning)', marginTop: 8, fontSize: 13 }}>{error}</p>}
        </div>

        {/* Spider + Overall combined */}
        <div className="overall-score-section" style={{ gap: 12, padding: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
          <div className="spider-chart-container">
            <SpiderChart scores={spiderScores} labels={spiderLabels} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 140 }}>
            <div style={{ textAlign: 'center' }}>
              <span className="score-number" style={{ color: getScoreColor(displayScores.overall), fontSize: 44 }}>{displayScores.overall}</span>
              <div className="score-label" style={{ fontSize: 11 }}>{getScoreLabel(displayScores.overall)}</div>
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <div className="stat-box">
                <span className="stat-val">{totalExchanges}</span>
                <span className="stat-lbl">Exchanges</span>
              </div>
              <div className="stat-box">
                <span className="stat-val">{formatTime(timeElapsed)}</span>
                <span className="stat-lbl">Duration</span>
              </div>
              <div className="stat-box">
                <span className="stat-val">{difficulty}</span>
                <span className="stat-lbl">Level</span>
              </div>
            </div>
          </div>
        </div>

        {/* Score Breakdown */}
        <div className="score-breakdown">
          <h3>Detailed Scores</h3>
          {[
            { key: 'structure', label: 'Problem Structuring', data: displayScores.structure },
            { key: 'analysis', label: 'Quantitative Analysis', data: displayScores.analysis },
            { key: 'recommendations', label: 'Recommendations', data: displayScores.recommendations },
            { key: 'communication', label: 'Communication', data: displayScores.communication },
          ].map((item) => (
            <div key={item.key} className="score-item">
              <div className="score-item-header">
                <span className="score-item-label">{item.label}</span>
                <span className="score-item-value" style={{ color: getScoreColor(item.data.score) }}>
                  {item.data.score}/100
                </span>
              </div>
              <div className="score-bar">
                <div
                  className="score-bar-fill"
                  style={{ width: `${item.data.score}%`, backgroundColor: getScoreColor(item.data.score) }}
                />
              </div>
              <p className="score-item-desc">{item.data.feedback}</p>
              <div className="score-item-evidence">
                <span className="evidence-icon">📌</span>
                <span className="evidence-text">{item.data.evidence}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Strengths & Improvements */}
        <div className="results-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
          {displayScores.strengths.length > 0 && (
            <div className="results-recommendations" style={{ borderLeft: '3px solid #22c55e', marginBottom: 0 }}>
              <h3>✅ Strengths</h3>
              <ul>
                {displayScores.strengths.map((s, i) => (
                  <li key={i}>
                    <span className="rec-bullet" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>✓</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {displayScores.improvements.length > 0 && (
            <div className="results-recommendations" style={{ borderLeft: '3px solid #f59e0b', marginBottom: 0 }}>
              <h3>📈 Areas to Improve</h3>
              <ul>
                {displayScores.improvements.map((r, i) => (
                  <li key={i}>
                    <span className="rec-bullet" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>→</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Thought Process Flow */}
        <div className="flowchart-section">
          <h3>🧠 Your Thought Process in Motion</h3>
          <p>How you moved from problem definition through exploration and reasoning toward your conclusion.</p>
          {reactFlowNodes.length > 0 ? (
            <div className="flowchart-container">
              <ReactFlowProvider>
                <ReactFlow
                  nodes={reactFlowNodes}
                  edges={reactFlowEdges}
                  nodeTypes={flowNodeTypes}
                  edgeTypes={flowEdgeTypes}
                  fitView
                  minZoom={0.4}
                  maxZoom={2}
                  style={{ width: '100%', height: '100%' }}
                >
                  <Background gap={32} color="rgba(255,255,255,0.04)" />
                  <Controls showInteractive={false} />
                </ReactFlow>
              </ReactFlowProvider>
            </div>
          ) : (
            <div className="flowchart-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              Complete a case session to see your thinking flowchart here
            </div>
          )}
        </div>

        {/* Summary */}
        <div className="results-recap">
          <h3>Summary</h3>
          <div className="recap-section">
            <p style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--text-secondary)' }}>{displayScores.summary}</p>
          </div>
          <div className="recap-section" style={{ marginTop: 16 }}>
            <label>Case</label>
            <p>{caseData.title} · {caseData.industry} · {difficulty}</p>
          </div>
          <div className="recap-section">
            <label>Key Facts</label>
            <ul>
              {caseData.keyFacts.slice(0, 5).map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Actions */}
        <div className="results-actions">
          <button className="btn-primary" onClick={onRestart}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            Practice Again
          </button>
          <button className="btn-secondary" onClick={onNewCase}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Try Another Case
          </button>
        </div>
      </div>
    </div>
  );
}

function heuristicScore(
  caseData: CaseData,
  userRole: 'interviewee' | 'interviewer',
  difficulty: string,
  messages: ChatMessage[]
): ScoreSet {
  // When the human is the interviewer, the AI (assistant) is the candidate being scored
  const userMessages = userRole === 'interviewee'
    ? messages.filter(m => m.role === 'user')
    : messages.filter(m => m.role === 'assistant');
  const aiMessages = userRole === 'interviewee'
    ? messages.filter(m => m.role === 'assistant')
    : messages.filter(m => m.role === 'user');
  const totalExchanges = Math.min(userMessages.length, aiMessages.length);

  const allUserText = userMessages.map(m => m.content).join(' ');
  const lower = allUserText.toLowerCase();

  const hasFramework = /framework|structure|approach|first,|second,|third,|i would|my approach/.test(lower);
  const hasMECE = /mece|mutually exclusive|collectively exhaustive/.test(lower);
  const hasHypothesis = /hypothesis|i think|my hypothesis|i believe/.test(lower);
  const hasNumbers = /\d+/.test(allUserText);
  const hasCalculations = /calculate|computation|math|revenue|profit|margin|cost|growth|market size/.test(lower);
  const hasDataRequest = /how much|what is|data|tell me about|can you provide/.test(lower);
  const hasRecommendation = /recommend|therefore|conclusion|suggest|i would advise|my recommendation/.test(lower);
  const hasRisks = /risk|challenge|concern|mitigate|downside/.test(lower);
  const hasTimeline = /timeline|implementation|roadmap|phase|step|plan/.test(lower);
  const hasStructure = /first|second|third|finally|in summary|to conclude/.test(lower);

  const avgLength = userMessages.length > 0
    ? userMessages.reduce((a, m) => a + m.content.length, 0) / userMessages.length
    : 0;

  // More realistic scoring with tighter ranges
  const structureScore = Math.min(92, Math.max(30, Math.round(
    40 +
    (hasFramework ? 18 : 0) +
    (hasMECE ? 12 : 0) +
    (hasHypothesis ? 8 : 0) +
    Math.min(totalExchanges * 1.5, 12) +
    (difficulty === 'Hard' ? 5 : difficulty === 'Expert' ? 8 : 0)
  )));

  const analysisScore = Math.min(92, Math.max(25, Math.round(
    30 +
    (hasNumbers ? 15 : 0) +
    (hasCalculations ? 15 : 0) +
    (hasDataRequest ? 10 : 0) +
    Math.min(totalExchanges * 1.5, 12) +
    (difficulty === 'Hard' || difficulty === 'Expert' ? 5 : 0)
  )));

  const recommendationScore = Math.min(92, Math.max(25, Math.round(
    28 +
    (hasRecommendation ? 18 : 0) +
    (hasRisks ? 15 : 0) +
    (hasTimeline ? 10 : 0) +
    Math.min(totalExchanges * 1.5, 10)
  )));

  const communicationScore = Math.min(92, Math.max(30, Math.round(
    42 +
    (avgLength > 60 && avgLength < 400 ? 15 : 0) +
    (hasStructure ? 12 : 0) +
    Math.min(totalExchanges * 1.5, 10) +
    (avgLength < 2000 ? 5 : 0)
  )));

  const overall = Math.round((structureScore + analysisScore + recommendationScore + communicationScore) / 4);

  const strengths: string[] = [];
  const improvements: string[] = [];

  if (hasFramework) strengths.push('Demonstrated structured thinking with a clear framework');
  if (hasNumbers) strengths.push('Used quantitative analysis to support arguments');
  if (hasRecommendation) strengths.push('Provided a clear recommendation with supporting rationale');
  if (hasDataRequest) strengths.push('Proactively asked for relevant data');
  if (hasHypothesis) strengths.push('Showed hypothesis-driven thinking throughout the case');
  if (strengths.length === 0) strengths.push('Engaged with the case material');

  if (structureScore < 55) improvements.push('Work on building MECE frameworks before diving into analysis');
  if (analysisScore < 55) improvements.push('Practice quantitative analysis and market sizing calculations');
  if (recommendationScore < 55) improvements.push('Always end with a clear recommendation including risks and timeline');
  if (communicationScore < 55) improvements.push('Use the pyramid principle: conclusion first, then supporting arguments');
  if (totalExchanges < 3) improvements.push('Explore the case more deeply with additional questions and analysis');
  if (improvements.length === 0) improvements.push('Continue practicing across different case types to build consistency');

  return {
    overall,
    structure: {
      score: structureScore,
      feedback: hasFramework
        ? 'Good use of structured thinking. Framework was relevant to the case context.'
        : 'Consider using a more structured approach. Start with a clear framework.',
      evidence: hasFramework ? 'Candidate proposed a structured approach' : 'No clear framework was proposed'
    },
    analysis: {
      score: analysisScore,
      feedback: hasNumbers
        ? 'Demonstrated quantitative analysis skills. Used data to support conclusions.'
        : 'More quantitative analysis needed. Practice incorporating numbers and calculations.',
      evidence: hasNumbers ? 'Candidate referenced specific numbers in analysis' : 'Limited quantitative analysis observed'
    },
    recommendations: {
      score: recommendationScore,
      feedback: hasRecommendation
        ? 'Provided a clear recommendation. Consider adding more detail on risks and implementation.'
        : 'Work on synthesizing findings into actionable recommendations with risk assessment.',
      evidence: hasRecommendation ? 'Candidate presented a final recommendation' : 'No clear recommendation was provided'
    },
    communication: {
      score: communicationScore,
      feedback: avgLength > 60 && avgLength < 400
        ? 'Communication was clear and well-structured. Good balance of detail and conciseness.'
        : 'Work on structuring your communication. Use signposts and keep responses focused.',
      evidence: `Avg response: ${Math.round(avgLength)} chars`
    },
    strengths,
    improvements,
    summary: `Completed ${totalExchanges} exchanges in a ${difficulty} ${caseData.category} case. Overall score: ${overall}/100.`
  };
}