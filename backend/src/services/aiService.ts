import { callGroq, parseJsonResult } from './groqService';
import { CaseData } from '../data/cases';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  messages: ChatMessage[];
  caseData: CaseData;
  userRole: 'interviewee' | 'interviewer';
  difficulty: string;
  sessionId: string;
  factRequests: number;
  frameworkProposed: boolean;
  hypothesisTested: boolean;
  quantitativeAnalysis: boolean;
}

const sessions = new Map<string, ChatSession>();

function getDifficultyInstructions(userRole: string, difficulty: string): string {
  if (userRole === 'interviewee') {
    if (difficulty === 'Easy') return 'Tone: supportive mentor. Provide clear hints when stuck. Guide toward the answer without giving it. Use phrases like "Good start, now dig deeper..." Hold them accountable but be constructive.';
    if (difficulty === 'Medium') return 'Tone: balanced professional interviewer. Probe frameworks, demand data-driven answers, push for "so what" insights. Let them struggle productively. Challenge weak assumptions.';
    if (difficulty === 'Hard') return 'Tone: demanding McKinsey partner. Challenge every assumption. Demean second-order effects, trade-offs, non-obvious insights. After recommendations, grill on execution risks and stakeholder alignment. Use "Interesting, but have you considered X?"';
    if (difficulty === 'Expert') return 'Tone: ruthless principal. Introduce curveballs ("What if the CEO quits?"). Expect A+ answers. Only reward truly sharp insights. Demand creative problem-solving under pressure.';
  }
  // interviewer mode (AI = candidate being interviewed)
  if (difficulty === 'Easy') return 'Tone: confident but curious candidate. CRITICAL RULES: (1) NEVER list a full framework. (2) NEVER dump case data. (3) NEVER give a conclusion unprompted. Instead: Ask 1-2 clarifying questions FIRST. Then propose ONE hypothesis. When the interviewer gives you data, say what it implies and ask for the next piece. Keep each response under 3 sentences. Think of this as a conversation, not a presentation.';
  if (difficulty === 'Medium') return 'Tone: sharp MBA candidate. CRITICAL RULES: (1) State 1 hypothesis, not a framework. (2) Never recite case facts — use them. (3) Never conclude without being asked. Instead: Start with your hypothesis and 1-2 questions. When data arrives, test your hypothesis out loud — say what you expected vs what you see. Ask for the next data point. Connect dots briefly. Keep it under 4 sentences per turn.';
  if (difficulty === 'Hard') return 'Tone: McKinsey-track candidate. CRITICAL RULES: (1) Lead with a crisp hypothesis + 1 assumption you need validated. (2) Never summarize the case back to the interviewer. (3) Never recommend until explicitly asked. Instead: Challenge data if it contradicts your hypothesis. Ask "what if" questions. Propose an implication from each data point. Keep responses tight (3-4 sentences). Show your thinking, not your conclusion.';
  if (difficulty === 'Expert') return 'Tone: exceptional candidate. CRITICAL RULES: (1) Reframe the problem if the interviewer is asking the wrong question. (2) Never dump data, never list frameworks, never conclude unprompted. Instead: Identify the unseen variable. Ask for sensitivity data. Propose a counterintuitive implication. Push back with "Help me understand — are we assuming X?" Keep it under 4 sentences. Every word must move the analysis forward.';
  return 'Tone: professional. Provide structured, data-driven analysis.';
}

function createSystemPrompt(caseData: CaseData, userRole: string, difficulty: string): string {
  const roleLabel = userRole === 'interviewee' ? 'INTERVIEWER (evaluating a candidate)' : 'CANDIDATE (being interviewed)';
  const dataLines = caseData.keyFacts.map((f, i) => `   ${f}`).join('\n');
  const hintLines = caseData.frameworkHints.map((h, i) => `   ${h}`).join('\n');
  const calcBlock = caseData.expectedCalculations
    ? '\nExpected Calculations:\n' + caseData.expectedCalculations.map((c, i) => `   ${c}`).join('\n')
    : '';
  const criteriaBlock = caseData.successCriteria
    ? '\nSuccess Criteria:\n' + caseData.successCriteria.map((s, i) => `   ${s}`).join('\n')
    : '\nSuccess Criteria: Use professional judgment.';
  const difficultyTone = getDifficultyInstructions(userRole, difficulty);

  return [
    `You are conducting a premium case interview simulation.`,
    `Role: ${roleLabel}`,
    `Difficulty Level: ${difficulty}`,
    `${difficultyTone}`,
    ``,
    `CASE: ${caseData.title}`,
    `Industry: ${caseData.industry} | Category: ${caseData.category}`,
    ``,
    `PROBLEM STATEMENT:\n${caseData.prompt}`,
    ``,
    `BACKGROUND:\n${caseData.context}`,
    ``,
    `KEY DATA (cite these exact figures — never invent numbers):\n${dataLines}`,
    ``,
    `FRAMEWORK HINTS (hint at these if the candidate struggles):\n${hintLines}`,
    `${calcBlock}`,
    `${criteriaBlock}`,
    ``,
    `RULES:`,
    `- Always reference the specific case and industry.`,
    `- Use the case data naturally in your responses. Do not reference data by number.`,
    `- No markdown, no bullet points, no asterisks.`,
    `- Responses: 3-5 sentences (Easy), 4-6 (Medium), 5-8+ (Hard/Expert).`,
  ].join('\n');
}

function getThoughtFor(type: string, label: string): string {
  const thoughts: Record<string, Record<string, string>> = {
    analysis: {
      'Market Attractiveness': 'Sizing the opportunity and understanding market dynamics',
      'Competitive Analysis': 'Assessing who the key players are',
      'Entry Mode Options': 'Evaluating build vs. partner vs. acquire trade-offs',
      'Revenue Analysis': 'Breaking down revenue drivers and trends',
      'Cost Structure': 'Understanding fixed vs. variable cost composition',
      'Data Gathering': 'Identifying what data is needed to test the hypothesis',
      'Current State Audit': 'Assessing the gap between current and desired state',
    },
    insight: {
      'Financial Projections': 'Modeling the financial implications of entry',
      'Risk Assessment': 'Identifying and quantifying key risks',
      'Price Elasticity': 'Understanding how price sensitivity affects pricing',
      'Tier Structure': 'Designing pricing tiers for different segments',
      'Key Findings': 'Synthesizing data into actionable insights',
      'Priority Initiatives': 'Identifying highest-impact initiatives',
    },
  };
  return (thoughts[type] && thoughts[type][label]) || `Analyzing: ${label}`;
}

function generateFlowchartFromSession(session: ChatSession): { nodes: any[]; edges: any[] } {
  const caseData = session.caseData;
  const messages = session.messages;

  // Build a flowchart based on conversation history and case structure
  const nodes: any[] = [];
  const edges: any[] = [];

  // Root: the problem
  nodes.push({
    id: 'problem',
    type: 'problem',
    label: caseData.title.length > 30 ? caseData.title.substring(0, 30) + '...' : caseData.title
  });

  // Category-specific flow nodes
  const categoryFlows: Record<string, { nodes: { id: string; type: string; label: string }[]; edges: { source: string; target: string; label: string }[] }> = {
    'Market Entry': {
      nodes: [
        { id: 'm1', type: 'analysis', label: 'Market Attractiveness' },
        { id: 'm2', type: 'analysis', label: 'Competitive Analysis' },
        { id: 'm3', type: 'analysis', label: 'Entry Mode Options' },
        { id: 'm4', type: 'insight', label: 'Financial Projections' },
        { id: 'm5', type: 'insight', label: 'Risk Assessment' },
        { id: 'm6', type: 'insight', label: 'Recommendation' },
      ],
      edges: [
        { source: 'problem', target: 'm1', label: 'Size opportunity' },
        { source: 'm1', target: 'm2', label: 'Assess players' },
        { source: 'm2', target: 'm3', label: 'Build/Partner/Buy' },
        { source: 'm3', target: 'm4', label: 'Model economics' },
        { source: 'm4', target: 'm5', label: 'Identify risks' },
        { source: 'm5', target: 'm6', label: 'Synthesize findings' }
      ]
    },
    'Profitability': {
      nodes: [
        { id: 'p1', type: 'analysis', label: 'Revenue Analysis' },
        { id: 'p2', type: 'analysis', label: 'Cost Structure' },
        { id: 'p3', type: 'analysis', label: 'Profit Tree Breakdown' },
        { id: 'p4', type: 'insight', label: 'Root Cause ID' },
        { id: 'p5', type: 'insight', label: 'Improvement Levers' },
        { id: 'p6', type: 'insight', label: 'Implementation Plan' },
      ],
      edges: [
        { source: 'problem', target: 'p1', label: 'Revenue trends' },
        { source: 'problem', target: 'p2', label: 'Cost analysis' },
        { source: 'p1', target: 'p3', label: 'Break down profit' },
        { source: 'p2', target: 'p3', label: 'Break down profit' },
        { source: 'p3', target: 'p4', label: 'Find root cause' },
        { source: 'p4', target: 'p5', label: 'Design solutions' },
        { source: 'p5', target: 'p6', label: 'Execute roadmap' }
      ]
    },
    'Pricing Strategy': {
      nodes: [
        { id: 'r1', type: 'analysis', label: 'Value Proposition' },
        { id: 'r2', type: 'analysis', label: 'Competitor Pricing' },
        { id: 'r3', type: 'analysis', label: 'Cost Analysis' },
        { id: 'r4', type: 'insight', label: 'Price Elasticity' },
        { id: 'r5', type: 'insight', label: 'Tier Structure' },
        { id: 'r6', type: 'insight', label: 'Go-to-Market Pricing' },
      ],
      edges: [
        { source: 'problem', target: 'r1', label: 'Customer WTP' },
        { source: 'problem', target: 'r2', label: 'Market bench' },
        { source: 'problem', target: 'r3', label: 'Cost-plus min' },
        { source: 'r1', target: 'r4', label: 'Demand curve' },
        { source: 'r2', target: 'r5', label: 'Positioning' },
        { source: 'r3', target: 'r5', label: 'Margin floor' },
        { source: 'r4', target: 'r5', label: 'Optimal price' },
        { source: 'r5', target: 'r6', label: 'Launch pricing' }
      ]
    },
    'Growth Strategy': {
      nodes: [
        { id: 'g1', type: 'analysis', label: 'Market Sizing' },
        { id: 'g2', type: 'analysis', label: 'Customer Segments' },
        { id: 'g3', type: 'analysis', label: 'Channel Analysis' },
        { id: 'g4', type: 'insight', label: 'Growth Levers' },
        { id: 'g5', type: 'insight', label: 'Investment Plan' },
        { id: 'g6', type: 'insight', label: 'Growth Roadmap' },
      ],
      edges: [
        { source: 'problem', target: 'g1', label: 'Size TAM' },
        { source: 'problem', target: 'g2', label: 'Who to target' },
        { source: 'g1', target: 'g4', label: 'Opportunity size' },
        { source: 'g2', target: 'g3', label: 'How to reach' },
        { source: 'g3', target: 'g4', label: 'Channel strategy' },
        { source: 'g4', target: 'g5', label: 'Resource allocation' },
        { source: 'g5', target: 'g6', label: 'Phased execution' }
      ]
    },
    'Operations / Supply Chain': {
      nodes: [
        { id: 'o1', type: 'analysis', label: 'Process Mapping' },
        { id: 'o2', type: 'analysis', label: 'Bottleneck ID' },
        { id: 'o3', type: 'analysis', label: 'Cost Drivers' },
        { id: 'o4', type: 'insight', label: 'Improvement Levers' },
        { id: 'o5', type: 'insight', label: 'Tech Enablement' },
        { id: 'o6', type: 'insight', label: 'Transformation Plan' },
      ],
      edges: [
        { source: 'problem', target: 'o1', label: 'Map value chain' },
        { source: 'o1', target: 'o2', label: 'Find constraints' },
        { source: 'o1', target: 'o3', label: 'Cost breakdown' },
        { source: 'o2', target: 'o4', label: 'Design fixes' },
        { source: 'o3', target: 'o4', label: 'Cost reduction' },
        { source: 'o4', target: 'o5', label: 'Automation opps' },
        { source: 'o5', target: 'o6', label: 'Rollout plan' }
      ]
    },
    'M&A / Corporate Strategy': {
      nodes: [
        { id: 'ma1', type: 'analysis', label: 'Strategic Rationale' },
        { id: 'ma2', type: 'analysis', label: 'Target Screening' },
        { id: 'ma3', type: 'analysis', label: 'Valuation' },
        { id: 'ma4', type: 'insight', label: 'Due Diligence' },
        { id: 'ma5', type: 'insight', label: 'Integration Plan' },
        { id: 'ma6', type: 'insight', label: 'Value Creation' },
      ],
      edges: [
        { source: 'problem', target: 'ma1', label: 'Why acquire?' },
        { source: 'ma1', target: 'ma2', label: 'Find targets' },
        { source: 'ma2', target: 'ma3', label: 'Value targets' },
        { source: 'ma3', target: 'ma4', label: 'Validate assumptions' },
        { source: 'ma4', target: 'ma5', label: 'Day 1 readiness' },
        { source: 'ma5', target: 'ma6', label: 'Synergy capture' }
      ]
    },
    'Digital Transformation': {
      nodes: [
        { id: 'd1', type: 'analysis', label: 'Current State Audit' },
        { id: 'd2', type: 'analysis', label: 'Tech Stack Analysis' },
        { id: 'd3', type: 'analysis', label: 'Customer Journey' },
        { id: 'd4', type: 'insight', label: 'Priority Initiatives' },
        { id: 'd5', type: 'insight', label: 'Change Management' },
        { id: 'd6', type: 'insight', label: 'Digital Roadmap' },
      ],
      edges: [
        { source: 'problem', target: 'd1', label: 'Assess gaps' },
        { source: 'problem', target: 'd2', label: 'Tech debt' },
        { source: 'problem', target: 'd3', label: 'Pain points' },
        { source: 'd1', target: 'd4', label: 'Quick wins' },
        { source: 'd2', target: 'd4', label: 'Platform strategy' },
        { source: 'd3', target: 'd4', label: 'UX priorities' },
        { source: 'd4', target: 'd5', label: 'Org readiness' },
        { source: 'd5', target: 'd6', label: 'Phased delivery' }
      ]
    }
  };

  // Find matching category flow or use generic
  const categoryKey = Object.keys(categoryFlows).find(k => 
    caseData.category.toLowerCase().includes(k.toLowerCase()) || 
    k.toLowerCase().includes(caseData.category.toLowerCase())
  );

  // User engagement tracking for dynamic nodes
  const userMsgs = messages.filter(m => m.role === 'user');
  const hasFramework = session.frameworkProposed || userMsgs.some(m => 
    m.content.toLowerCase().includes('framework') || m.content.toLowerCase().includes('structure')
  );
  const hasNumbers = session.quantitativeAnalysis || userMsgs.some(m =>
    /\d/.test(m.content) && (m.content.toLowerCase().includes('million') || m.content.toLowerCase().includes('billion') || m.content.includes('%'))
  );
  const hasRecommendation = userMsgs.some(m =>
    m.content.toLowerCase().includes('recommend') || m.content.toLowerCase().includes('therefore') || m.content.toLowerCase().includes('conclusion')
  );
  const messageCount = messages.length;

  if (categoryKey) {
    const flow = categoryFlows[categoryKey];
    flow.nodes.forEach((n, i) => {
      // Only include nodes that have been "reached" based on conversation progress
      const threshold = Math.min(i, Math.floor(messageCount / 3));
      if (i <= threshold + 1) {
        nodes.push({ ...n, id: `${n.id}`, thoughtProcess: getThoughtFor(n.type, n.label), depth: i + 1 });
      }
    });
    flow.edges.forEach((e, i) => {
      const sourceExists = nodes.some(n => n.id === e.source);
      const targetExists = nodes.some(n => n.id === e.target);
      if (sourceExists && targetExists) {
        edges.push({ id: `edge-${i}`, ...e, reasoning: `From ${e.source} to ${e.target}: ${e.label}` });
      }
    });
  } else {
    // Generic fallback flow
    const genericNodes = [
      { id: 'a1', type: 'analysis', label: 'Problem Analysis', thoughtProcess: 'Breaking down the problem into key components', depth: 1 },
      { id: 'a2', type: 'analysis', label: 'Data Gathering', thoughtProcess: 'Identifying required data and sources', depth: 2 },
      { id: 'a3', type: 'analysis', label: 'Hypothesis Testing', thoughtProcess: 'Forming and testing hypotheses against data', depth: 3 },
      { id: 'a4', type: 'insight', label: 'Key Findings', thoughtProcess: 'Synthesizing data into actionable insights', depth: 4 },
      { id: 'a5', type: 'recommendation', label: 'Recommendation', thoughtProcess: 'Forming actionable recommendation', depth: 5 },
    ];
    const genericEdges = [
      { source: 'problem', target: 'a1', label: 'Define scope', reasoning: 'Need to scope the problem before gathering data' },
      { source: 'a1', target: 'a2', label: 'Request data', reasoning: 'Structured problem needs supporting data' },
      { source: 'a2', target: 'a3', label: 'Test hypotheses', reasoning: 'Data should validate or refute initial hypotheses' },
      { source: 'a3', target: 'a4', label: 'Synthesize', reasoning: 'Test results reveal key findings' },
      { source: 'a4', target: 'a5', label: 'Action plan', reasoning: 'Findings point to actionable recommendation' },
    ];
    genericNodes.forEach(n => nodes.push(n));
    genericEdges.forEach((e, i) => edges.push({ id: `edge-${i}`, ...e, reasoning: `From ${e.source} to ${e.target}: ${e.label}` }));
  }

  // Add dynamic nodes based on user actions
  if (hasFramework) {
    const frameworkId = 'framework-node';
    if (!nodes.some(n => n.id === frameworkId)) {
      nodes.push({ id: frameworkId, type: 'insight', label: 'Framework Proposed', thoughtProcess: 'Structured the problem using a MECE framework', depth: nodes.length });
      // Connect from the first analysis node
      const firstAnalysis = nodes.find(n => n.type === 'analysis' || n.type === 'insight');
      if (firstAnalysis && firstAnalysis.id !== frameworkId) {
        edges.push({ id: 'edge-framework', source: firstAnalysis.id, target: frameworkId, label: 'Structured thinking' });
      }
    }
  }

  if (hasNumbers) {
    const quantId = 'quant-node';
    if (!nodes.some(n => n.id === quantId)) {
      nodes.push({ id: quantId, type: 'analysis', label: 'Quant Analysis', thoughtProcess: 'Dug into numbers to test key hypotheses', depth: nodes.length });
      const prevNode = nodes[nodes.length - 2];
      if (prevNode && prevNode.id !== quantId) {
        edges.push({ id: 'edge-quant', source: prevNode.id, target: quantId, label: 'Number crunch' });
      }
    }
  }

  if (hasRecommendation) {
    const recId = 'rec-node';
    if (!nodes.some(n => n.id === recId)) {
      nodes.push({ id: recId, type: 'recommendation', label: 'Final Recommendation', thoughtProcess: 'Synthesized insights into a clear recommendation', depth: nodes.length });
      const prevNode = nodes[nodes.length - 2];
      if (prevNode && prevNode.id !== recId) {
        edges.push({ id: 'edge-rec', source: prevNode.id, target: recId, label: 'Synthesized decision' });
      }
    }
  }

  // Add a "dead-end" node only if the user seems genuinely stuck (rare)
  // Require 4+ user messages AND no framework/number detection AND no recommendation
  if (userMsgs.length >= 4 && !hasFramework && !hasNumbers && !hasRecommendation) {
    const shortMsgs = userMsgs.every(m => m.content.trim().length < 40);
    if (shortMsgs) {
      nodes.push({ id: 'stuck', type: 'dead-end', label: '⚠️ Need more structure', thoughtProcess: 'Lacking structured approach; guidance needed', depth: 2 });
      edges.push({ id: 'edge-stuck', source: 'problem', target: 'stuck', label: 'Redirect needed' });
    }
  }

  return { nodes, edges };
}

export async function initSession(
  sessionId: string,
  caseData: CaseData,
  userRole: 'interviewee' | 'interviewer',
  difficulty: string
): Promise<void> {
  if (sessions.has(sessionId)) return;

  const systemPrompt = createSystemPrompt(caseData, userRole, difficulty);
  const session: ChatSession = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: 'Ready to begin' }
    ],
    caseData,
    userRole,
    difficulty,
    sessionId,
    factRequests: 0,
    frameworkProposed: false,
    hypothesisTested: false,
    quantitativeAnalysis: false,
  };

  // Generate initial reply
  const groqReply = await callGroq(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userRole === 'interviewee'
        ? 'Start the case interview. Present the case to the candidate. Greet them and present the prompt.'
        : 'Start the case interview. You are the candidate. Thank the interviewer and introduce your structured approach to solving the case.' }
    ],
    { temperature: 0.7, maxTokens: 1200 }
  );
  session.messages.push({ role: 'assistant', content: groqReply });
  sessions.set(sessionId, session);
}

export async function processChat(
  sessionId: string,
  message: string,
  caseData: CaseData,
  userRole: 'interviewee' | 'interviewer',
  difficulty: string
): Promise<{ reply: string; sessionId: string }> {
  let session = sessions.get(sessionId);
  if (!session) {
    await initSession(sessionId, caseData, userRole, difficulty);
    session = sessions.get(sessionId)!;
  }

  // Add user message
  session.messages.push({ role: 'user', content: message });

  // Analyze message
  const lower = message.toLowerCase();
  if (lower.includes('framework') || lower.includes('structure') || lower.includes('approach') ||
      lower.includes('my approach') || lower.includes('first,') || lower.includes('i would')) {
    session.frameworkProposed = true;
  }
  if (lower.includes('calculate') || lower.includes('revenue') || lower.includes('profit') ||
      lower.includes('margin') || /\d+/.test(message)) {
    session.quantitativeAnalysis = true;
  }

  // Get Groq response
  const groqMessages = [
    { role: 'system', content: createSystemPrompt(caseData, userRole, difficulty) },
    ...session.messages.slice(1).map(m => ({ role: m.role, content: m.content }))
  ];

  const reply = await callGroq(groqMessages, { temperature: 0.7, maxTokens: 1500 });
  session.messages.push({ role: 'assistant', content: reply });

  // Keep session manageable
  if (session.messages.length > 52) {
    session.messages = [session.messages[0], ...session.messages.slice(-50)];
  }

  sessions.set(sessionId, session);
  return { reply, sessionId };
}

export function getFlowchart(
  sessionId: string
): { nodes: any[]; edges: any[] } {
  const session = sessions.get(sessionId);
  if (!session) {
    return {
      nodes: [{ id: 'problem', type: 'problem', label: 'Case Problem' }],
      edges: []
    };
  }
  return generateFlowchartFromSession(session);
}

export function getSession(sessionId: string): ChatSession | undefined {
  return sessions.get(sessionId);
}

export function clearSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

export function getSessionMessages(sessionId: string): { role: string; content: string }[] {
  const session = sessions.get(sessionId);
  return session ? session.messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })) : [];
}

export async function generateCaseWithGroq(
  category: string,
  difficulty: string
): Promise<CaseData> {
  const prompt = `
Generate a consulting case interview problem for a ${difficulty} difficulty ${category} case.
Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "id": "unique-string",
  "title": "Case title",
  "category": "${category}",
  "industry": "relevant industry",
  "difficulty": "${difficulty}",
  "prompt": "2-3 sentence problem statement",
  "context": "2-3 sentences of background context",
  "keyFacts": [array of 6-8 specific, quantitative facts],
  "frameworkHints": [array of 4-6 structured thinking hints],
  "expectedCalculations": [array of 2-4 expected calculations],
  "successCriteria": [array of 4-6 success criteria]
}`;

  const raw = await callGroq(
    [
      { role: 'system', content: 'You are a senior case writer at McKinsey. Generate realistic consulting cases. Return ONLY valid JSON.' },
      { role: 'user', content: prompt }
    ],
    { temperature: 0.9, maxTokens: 1500 }
  );

  return parseJsonResult<CaseData>(raw);
}
