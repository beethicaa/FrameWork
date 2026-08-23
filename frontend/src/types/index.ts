export interface CaseData {
  id: string;
  title: string;
  category: string;
  industry: string;
  difficulty: 'Easy' | 'Medium' | 'Hard' | 'Expert';
  prompt: string;
  context: string;
  keyFacts: string[];
  exhibits?: Exhibit[];
  frameworkHints: string[];
  expectedCalculations?: string[];
  successCriteria: string[];
}

interface Exhibit {
  title: string;
  data: Record<string, string | number>[];
  description: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  sessionId: string;
  caseData: CaseData;
  userRole: 'interviewee' | 'interviewer';
  difficulty: string;
  messages: ChatMessage[];
}

export type AppScreen = 'landing' | 'category-select' | 'case-select' | 'role-select' | 'difficulty-select' | 'chat' | 'results';

export interface CaseFilters {
  category?: string;
  difficulty?: string;
  search?: string;
  industry?: string;
}

// ─── Flowchart Types ───

export interface FlowNode {
  id: string;
  type: 'problem' | 'hypothesis' | 'exploration' | 'analysis' | 'insight' | 'recommendation' | 'dead-end';
  label: string;
  thoughtProcess: string;
  depth: number;
  position?: { x: number; y: number };
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  reasoning: string;
}

export interface Flowchart {
  nodes: FlowNode[];
  edges: FlowEdge[];
}