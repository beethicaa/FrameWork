import { callGroq } from './groqService';
import { CaseData } from '../data/cases';

export interface ScoreResult {
  overall: number;
  structure: { score: number; feedback: string; evidence: string };
  analysis: { score: number; feedback: string; evidence: string };
  recommendations: { score: number; feedback: string; evidence: string };
  communication: { score: number; feedback: string; evidence: string };
  strengths: string[];
  improvements: string[];
  summary: string;
}

export async function evaluateConversation(
  caseData: CaseData,
  userRole: 'interviewee' | 'interviewer',
  difficulty: string,
  messages: { role: string; content: string }[]
): Promise<ScoreResult> {
  const userMessages = messages.filter(m => m.role === 'user');
  const aiMessages = messages.filter(m => m.role === 'assistant');

  if (userMessages.length === 0) {
    return getDefaultScore('No conversation to evaluate');
  }

  const conversationLog = messages
    .map(m => `[${m.role === 'user' ? 'CANDIDATE' : 'INTERVIEWER'}]: ${m.content}`)
    .join('\n\n');

  const prompt = `You are a senior McKinsey partner evaluating a case interview performance.

CASE: ${caseData.title}
INDUSTRY: ${caseData.industry}
CATEGORY: ${caseData.category}
DIFFICULTY: ${difficulty}
ROLE: ${userRole === 'interviewee' ? 'The HUMAN was the candidate being interviewed. Evaluate the CANDIDATE (INTERVIEWER-labeled lines are the AI).' : 'The AI played the candidate. Evaluate the CANDIDATE (the lines labeled CANDIDATE).'}

CASE PROMPT: ${caseData.prompt}
CONTEXT: ${caseData.context}

SUCCESS CRITERIA:
${caseData.successCriteria.map((s, i) => `${i + 1}. ${s}`).join('\n')}

EXPECTED CALCULATIONS:
${(caseData.expectedCalculations || []).map((c, i) => `${i + 1}. ${c}`).join('\n')}

CONVERSATION TRANSCRIPT:
${conversationLog}

Evaluate the candidate's performance based on the conversation above. Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "overall": <0-100>,
  "structure": {
    "score": <0-100>,
    "feedback": "2-3 sentence evaluation of problem structuring",
    "evidence": "specific quote or moment from conversation"
  },
  "analysis": {
    "score": <0-100>,
    "feedback": "2-3 sentence evaluation of quantitative and qualitative analysis",
    "evidence": "specific quote or moment from conversation"
  },
  "recommendations": {
    "score": <0-100>,
    "feedback": "2-3 sentence evaluation of synthesis and recommendations",
    "evidence": "specific quote or moment from conversation"
  },
  "communication": {
    "score": <0-100>,
    "feedback": "2-3 sentence evaluation of clarity and structure",
    "evidence": "specific quote or moment from conversation"
  },
  "strengths": ["strength1", "strength2", "strength3"],
  "improvements": ["improvement1", "improvement2", "improvement3"],
  "summary": "2-3 sentence overall performance summary"
}

Scoring guidelines:
- 90-100: Exceptional (MBB offer level)
- 75-89: Strong (would advance in process)
- 60-74: Solid (needs work but shows potential)
- 40-59: Developing (significant gaps)
- Below 40: Needs fundamental improvement

Base your scores on actual evidence from the conversation. Be specific and honest.`;

  try {
    const raw = await callGroq(
      [
        { role: 'system', content: 'You are a senior McKinsey partner evaluating case interviews. Return ONLY valid JSON.' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.3, maxTokens: 2000 }
    );

    const parsed = parseJsonResult<ScoreResult>(raw);
    return validateScore(parsed);
  } catch (err) {
    console.error('Scoring error, falling back to heuristic:', err);
    return heuristicScore(caseData, userRole, difficulty, messages);
  }
}

function parseJsonResult<T>(text: string): T {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Unable to parse JSON response');
  }
}

function validateScore(score: ScoreResult): ScoreResult {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  score.overall = clamp(score.overall);
  score.structure.score = clamp(score.structure.score);
  score.analysis.score = clamp(score.analysis.score);
  score.recommendations.score = clamp(score.recommendations.score);
  score.communication.score = clamp(score.communication.score);
  return score;
}

function heuristicScore(
  caseData: CaseData,
  userRole: 'interviewee' | 'interviewer',
  difficulty: string,
  messages: { role: string; content: string }[]
): ScoreResult {
  const userMessages = messages.filter(m => m.role === 'user');
  const aiMessages = messages.filter(m => m.role === 'assistant');
  const totalExchanges = Math.min(userMessages.length, aiMessages.length);

  const allUserText = userMessages.map(m => m.content).join(' ');
  const lower = allUserText.toLowerCase();

  // Structure detection
  const hasFramework = /framework|structure|approach|first,|second,|third,|i would|my approach/.test(lower);
  const hasMECE = /mece|mutually exclusive|collectively exhaustive/.test(lower);
  const hasHypothesis = /hypothesis|i think|my hypothesis|i believe/.test(lower);
  const structureScore = Math.min(95, Math.round(
    40 +
    (hasFramework ? 20 : 0) +
    (hasMECE ? 15 : 0) +
    (hasHypothesis ? 10 : 0) +
    Math.min(totalExchanges * 2, 10)
  ));

  // Analysis detection
  const hasNumbers = /\d+/.test(allUserText);
  const hasCalculations = /calculate|computation|math|revenue|profit|margin|cost|growth|market size/.test(lower);
  const hasDataRequest = /how much|what is|data|tell me about|can you provide/.test(lower);
  const analysisScore = Math.min(95, Math.round(
    35 +
    (hasNumbers ? 15 : 0) +
    (hasCalculations ? 15 : 0) +
    (hasDataRequest ? 10 : 0) +
    Math.min(totalExchanges * 2, 10)
  ));

  // Recommendation detection
  const hasRecommendation = /recommend|therefore|conclusion|suggest|i would advise|my recommendation/.test(lower);
  const hasRisks = /risk|challenge|concern|mitigate|downside/.test(lower);
  const hasTimeline = /timeline|implementation|roadmap|phase|step|plan/.test(lower);
  const recommendationScore = Math.min(95, Math.round(
    30 +
    (hasRecommendation ? 20 : 0) +
    (hasRisks ? 15 : 0) +
    (hasTimeline ? 10 : 0) +
    Math.min(totalExchanges * 2, 10)
  ));

  // Communication detection
  const avgLength = userMessages.length > 0
    ? userMessages.reduce((a, m) => a + m.content.length, 0) / userMessages.length
    : 0;
  const hasStructure = /first|second|third|finally|in summary|to conclude/.test(lower);
  const communicationScore = Math.min(95, Math.round(
    45 +
    (avgLength > 50 && avgLength < 500 ? 15 : 0) +
    (hasStructure ? 15 : 0) +
    Math.min(totalExchanges * 2, 10)
  ));

  const overall = Math.round((structureScore + analysisScore + recommendationScore + communicationScore) / 4);

  const strengths: string[] = [];
  const improvements: string[] = [];

  if (hasFramework) strengths.push('Demonstrated structured thinking with a clear framework');
  if (hasNumbers) strengths.push('Used quantitative analysis to support arguments');
  if (hasRecommendation) strengths.push('Provided a clear recommendation with supporting rationale');
  if (hasDataRequest) strengths.push('Proactively asked for relevant data');
  if (strengths.length === 0) strengths.push('Engaged with the case material');

  if (structureScore < 60) improvements.push('Work on building MECE frameworks before diving into analysis');
  if (analysisScore < 60) improvements.push('Practice quantitative analysis and market sizing calculations');
  if (recommendationScore < 60) improvements.push('Always end with a clear recommendation including risks and timeline');
  if (communicationScore < 60) improvements.push('Use the pyramid principle: conclusion first, then supporting arguments');
  if (totalExchanges < 4) improvements.push('Explore the case more deeply with additional questions and analysis');
  if (improvements.length === 0) improvements.push('Continue practicing across different case types to build consistency');

  return {
    overall,
    structure: {
      score: structureScore,
      feedback: hasFramework
        ? 'Good use of structured thinking. The framework was relevant to the case context.'
        : 'Consider using a more structured approach. Start with a clear framework before diving into analysis.',
      evidence: hasFramework ? 'Candidate proposed a structured approach to the problem' : 'No clear framework was proposed'
    },
    analysis: {
      score: analysisScore,
      feedback: hasNumbers
        ? 'Demonstrated quantitative analysis skills. Used data to support conclusions.'
        : 'More quantitative analysis needed. Practice incorporating numbers and calculations.',
      evidence: hasNumbers ? 'Candidate referenced specific numbers in their analysis' : 'Limited quantitative analysis observed'
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
      feedback: avgLength > 50 && avgLength < 500
        ? 'Communication was clear and well-structured. Good balance of detail and conciseness.'
        : 'Work on structuring your communication. Use signposts and keep responses focused.',
      evidence: `Average response length: ${Math.round(avgLength)} characters`
    },
    strengths,
    improvements,
    summary: `Completed ${totalExchanges} exchanges in a ${difficulty} ${caseData.category} case. Overall score: ${overall}/100.`
  };
}

function getDefaultScore(reason: string): ScoreResult {
  return {
    overall: 0,
    structure: { score: 0, feedback: 'No conversation data available', evidence: reason },
    analysis: { score: 0, feedback: 'No conversation data available', evidence: reason },
    recommendations: { score: 0, feedback: 'No conversation data available', evidence: reason },
    communication: { score: 0, feedback: 'No conversation data available', evidence: reason },
    strengths: [],
    improvements: ['Start a case session to receive detailed feedback'],
    summary: 'No conversation to evaluate.'
  };
}