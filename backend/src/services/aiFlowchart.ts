import { callGroq, parseJsonResult } from './groqService';

export interface FlowchartData {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    thoughtProcess?: string;
    depth?: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label: string;
    reasoning: string;
  }>;
}

const VALID_TYPES = new Set([
  'problem', 'hypothesis', 'exploration', 'analysis', 'insight', 'recommendation', 'dead-end'
]);

// Word-aware truncation: never cut mid-word, append ellipsis only when needed.
function truncate(s: unknown, max: number): string {
  const str = String(s ?? '').trim();
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + '…';
}

/**
 * Reconstructs the candidate's ACTUAL thought process from the conversation
 * transcript using the LLM, producing a dynamic flowchart that reflects real
 * hypotheses, explorations, dead-ends and conclusions — not a fixed template.
 */
export async function generateAIFlowchart(
  messages: Array<{ role: string; content: string }>
): Promise<FlowchartData | null> {
  if (messages.length < 4) return null;

  const NL = String.fromCharCode(10);
  const transcript = messages
    .filter(m => m.role !== 'system')
    .map(m => (m.role === 'user' ? 'CANDIDATE: ' : 'INTERVIEWER: ') + m.content)
    .join(NL);

  const prompt = [
    'Analyze this case interview transcript and extract the thinker\u2019s ACTUAL thought process as a flowchart.',
    '',
    transcript,
    '',
    'Return ONLY valid JSON, no markdown, no explanation:',
    '{"nodes":[{"id":"n1","type":"problem","label":"short title max 25 chars","thoughtProcess":"what the thinker was reasoning at this step, one sentence","depth":0}],"edges":[{"source":"n1","target":"n2","label":"transition max 20 chars","reasoning":"why this step led to the next, one short sentence"}]}',
    '',
    'Rules:',
    '- First node: type "problem", representing the core question being tackled',
    '- Only include steps that ACTUALLY happened in the conversation above',
    '- Node types: problem, hypothesis, exploration, analysis, insight, recommendation, dead-end',
    '- Mark approaches that were tried and abandoned as dead-end nodes',
    '- If a recommendation was reached, the last node must be type "recommendation"',
    '- depth increases as the analysis goes deeper (0 for problem, higher for later steps)',
    '- 4-10 nodes total, connected in sequence (branches allowed where the thinking split)',
    '',
    'LABEL QUALITY (critical):',
    '- A node label must be a SHORT, COMPLETE summary of that step — 3 to 6 words max, no truncation needed.',
    '  GOOD: "Revenue vs cost tree", "Test $12 vs $15 price", "Urban millennial segment", "Rent doubled"',
    '  BAD (never do this): "candidate", "ask", "refine", "plan", "question", "response", or any long sentence that would need an ellipsis',
    '- Never use speaker names, conversation mechanics, or single generic words as labels',
    '- An edge label must be a SHORT, COMPLETE phrase (2-4 words) describing HOW or WHY the thinking moved, e.g.',
    '  GOOD: "tested vs margin", "contradicted by costs", "validated by data", "split by segment"',
    '  BAD (never do this): "candidate", "refine", "ask", "plan", "then", "next", or long sentences',
    '',
    'Example of a good chart for a coffee-shop profitability case:',
    'nodes: problem("Why profits down 20%?") -> analysis("Break down P&L") -> insight("Rent doubled") -> analysis("Footfall vs rent") -> recommendation("Renegotiate lease")',
    'edge labels: "structure P&L", "rent is outlier", "quantify traffic", "data supports move"',
  ].join(NL);

  try {
    const raw = await callGroq(
      [
        { role: 'system', content: 'You are an expert at reconstructing consulting thought processes. Return ONLY valid JSON.' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.3, maxTokens: 1500 }
    );

    const parsed = parseJsonResult<{ nodes: any[]; edges: any[] }>(raw);
    if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length < 3 || !Array.isArray(parsed.edges)) {
      return null;
    }

    // Validate & normalize nodes
    const nodes = parsed.nodes
      .filter(n => n && n.id && n.label)
      .map(n => ({
        id: String(n.id),
        type: VALID_TYPES.has(n.type) ? n.type : 'analysis',
        label: truncate(n.label, 60),
        thoughtProcess: n.thoughtProcess ? String(n.thoughtProcess) : undefined,
        depth: typeof n.depth === 'number' ? Math.max(0, Math.min(9, n.depth)) : 0,
      }));

    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = parsed.edges
      .filter(e => e && nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e, i) => ({
        id: `edge-${i}`,
        source: e.source,
        target: e.target,
        label: e.label ? truncate(e.label, 40) : '',
        reasoning: e.reasoning ? String(e.reasoning) : (e.label ? String(e.label) : ''),
      }));

    if (nodes.length >= 3 && edges.length >= 2) {
      return { nodes, edges };
    }
    return null;
  } catch (err) {
    console.error('AI flowchart generation failed:', err);
    return null;
  }
}