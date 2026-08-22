const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

function getApiKeys(): string[] {
  const keys: string[] = [];
  const primary = process.env.GROQ_API_KEY;
  const fallback = process.env.GROQ_FALLBACK_API_KEY;
  if (primary && primary !== 'your-groq-api-key-here') keys.push(primary);
  if (fallback && fallback !== 'your-groq-api-key-here') keys.push(fallback);
  return keys;
}

export async function callGroq(
  messages: Array<{ role: string; content: string }>,
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  const keys = getApiKeys();
  const useMock = process.env.USE_MOCK_AI === 'true' || keys.length === 0;

  if (useMock) {
    return cleanMarkdown(generateMockResponse(messages));
  }

  let lastError: string = '';

  // Try each key with long backoff on rate limits (same org = shared bucket)
  for (let i = 0; i < keys.length; i++) {
    const maxRetries = 2;
    for (let retry = 0; retry < maxRetries; retry++) {
      try {
        const controller = new AbortController();
        const timeoutMs = 10000;
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(GROQ_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keys[i]}`
          },
          body: JSON.stringify({
            model: 'qwen/qwen3.6-27b',
            messages,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 1024
          }),
          signal: controller.signal
        });

        if (response.ok) {
          const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
          const raw = payload?.choices?.[0]?.message?.content;
          if (typeof raw === 'string') return cleanMarkdown(raw.trim());
          throw new Error('Unexpected response from Groq API');
        }

        const text = await response.text();
        lastError = `Key ${i + 1} error ${response.status}: ${text.substring(0, 100)}`;
        console.error(`Groq API key ${i + 1} failed (attempt ${retry + 1}/${maxRetries}):`, lastError);

        // If it's not a rate limit error (e.g., auth error), don't retry
        if (response.status !== 429) {
          break;
        }

        // Rate limit: both keys share the same org bucket, so wait ~60s for window reset
        const backoffMs = 1000;
        console.log(`Rate limited, backing off for ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      } catch (err) {
        lastError = `Key ${i + 1} error: ${(err as Error).message}`;
        console.error(`Groq API key ${i + 1} failed (attempt ${retry + 1}/${maxRetries}):`, lastError);
        // On non-429 errors, break
        if (!(err instanceof Error && err.message.includes('429'))) {
          break;
        }
        const backoffMs = 1000;
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  // All keys exhausted — fall back to mock
  console.error('All Groq API keys exhausted, using mock AI. Last error:', lastError);
  return cleanMarkdown(generateMockResponse(messages));
}

export function parseJsonResult<T>(text: string): T {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) return JSON.parse(arrayMatch[0]);
    throw new Error('Unable to parse JSON response');
  }
}

function cleanMarkdown(text: string): string {
  let result = text;

  // Strip reasoning/thinking blocks (qwen reasoning models output chain-of-thought before the answer)
  // 1. XML-style <thinking>...</thinking> tags
  result = result.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
  // 2. " thinking" ... "/thinking" markers
  result = result.replace(/^\s*thinking\s*$/gim, '');
  result = result.replace(/\/thinking/gi, '');
  // 3. "Thinking Process:" section — strip from the header up to the actual answer
  result = result.replace(/Thinking Process:[\s\S]*?(?=\n\n[A-Z]|\n[A-Z][a-z]+:|\nThank|\nHere|\nI'd|\nLet|\nGreat|\nBased|\nGood|\nThat|\nInteresting|\nCan I|\nWhat|\nHow|\nWhy|\nFirst|\nSpecifically|\nOnce|\nAlso|\nTell|\nWalk|\nWhere|\nWhich|\nWhen|\nDo|\nIs|\nAre|\nWill|\nShould|\nCould|\nWould|\nMy|\nOur|\nThe|\nA\s)/i, '');

  // First pass: strip matched markdown pairs
  result = result
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1');
  // Second pass: strip any remaining unmatched * or _ characters
  result = result.replace(/[*_]/g, '');
  // Third pass: clean up list markers
  result = result.replace(/^\s*[-*+]\s/gm, '• ');
  result = result.replace(/^\s*\d+\.\s/gm, (m) => m.trim().replace('.', ' '));
  return result.trim();
}

function generateMockResponse(messages: Array<{ role: string; content: string }>): string {
  // Extract case info from system message
  const systemMsg = messages.find(m => m.role === 'system')?.content || '';
  const userMessages = messages.filter(m => m.role === 'user');
  const lastUserMsg = userMessages.pop()?.content || '';
  const lower = lastUserMsg.toLowerCase();

  // Try to parse case details from the system prompt
  const caseTitleMatch = systemMsg.match(/CASE: (.+)/);
  const caseTitle = caseTitleMatch ? caseTitleMatch[1] : '';
  const categoryMatch = systemMsg.match(/Category: (.+)/);
  const category = categoryMatch ? categoryMatch[1] : '';
  const promptMatch = systemMsg.match(/CASE PROMPT \(what the candidate sees\):\n([\s\S]*?)(?:\n\n|\n════|$)/);
  const casePrompt = promptMatch ? promptMatch[1].trim() : '';
  const factsSection = systemMsg.match(/CONFIDENTIAL DATA[\s\S]*?FRAMEWORK GUIDANCE/);
  const factsStr = factsSection ? factsSection[0] : '';
  const keyFacts = factsStr.split('\n').filter(l => l.startsWith('- ')).map(l => l.replace('- ', ''));

  // Determine interviewer vs interviewee mode (match new system prompt format)
  const isInterviewer = systemMsg.includes('CANDIDATE (being interviewed)');
  const isCandidate = systemMsg.includes('INTERVIEWER (evaluating a candidate)');

  // Conversation state tracking
  const userMsgCount = userMessages.length;
  const hasFramework = userMessages.some(m =>
    /framework|structure|approach|first,|second,|i would|my approach/.test(m.content.toLowerCase())
  );
  const hasDataRequest = userMessages.some(m =>
    /how much|what is|data|tell me about|can you provide|give me/.test(m.content.toLowerCase())
  );
  const hasQuantAnalysis = userMessages.some(m =>
    /\d+/.test(m.content) && (/million|billion|%|revenue|profit|margin|cost|calculate/.test(m.content.toLowerCase()))
  );
  const hasRecommendation = userMessages.some(m =>
    /recommend|therefore|conclusion|suggest|i would advise|my recommendation/.test(m.content.toLowerCase())
  );

  // ---- INTERVIEWEE mode (user is candidate, AI is interviewer) ----
  if (isInterviewer) {
    // First message: present the case
    if (lower.includes('ready') || lower.includes('begin') || lower.includes('start') || userMsgCount <= 1) {
      return `Thank you for joining me today. Let's dive right in.

Here's your case: ${casePrompt || 'A company is facing a strategic challenge and needs your analysis.'}

I'd like you to walk me through your approach. Where would you like to start? What framework would you use to structure your thinking?`;
    }

    if (hasRecommendation) {
      return `Good recommendation. Let me pressure-test it a bit:

1. What's the single biggest risk in your plan and how would you mitigate it?
2. What's your implementation timeline — first 90 days versus year one?
3. How would you measure success? What specific KPIs would you track?
4. And what's your Plan B if your key assumptions don't hold?`;

    }

    if (hasFramework && hasQuantAnalysis) {
      return `Good analysis. You've identified some important numbers.

Now, what does this tell you? I want you to step back and ask yourself: **so what?** What's your hypothesis at this point, and what additional data would you need to confirm or reject it?

Walk me through your synthesis — what are the top 2-3 insights you've uncovered so far?`;
    }

    if (hasFramework) {
      return `That's a solid framework. Let me push a bit deeper.

You've laid out the structure well. Which branch would you prioritize first and why? What specific analyses would you run, and what data would you need?

Also, be specific about what you're hypothesizing. In this ${category || 'case'}, what do you suspect the core issue might be?`;
    }

    if (lower.includes('?') || lower.includes('how') || lower.includes('what') || lower.includes('why') || hasDataRequest) {
      // Provide a case-relevant data point
      const availableFacts = keyFacts.length > 0 ? keyFacts : [
        `The total addressable market is estimated at $2.5B with 15% CAGR`,
        `Current market penetration is 35% among target customers`,
        `Average customer acquisition cost is $450`,
        `Customer lifetime value is approximately $2,800`,
        `Gross margins in this segment average 45%`
      ];
      const fact = availableFacts[Math.floor(Math.random() * availableFacts.length)];
      return `Good question. Here's a relevant data point:

📊 ${fact}

How does this inform your thinking? And what else would you like to know before forming a hypothesis?`;
    }

    return `Interesting. Let me challenge you on that.

What assumptions are you making, and how confident are you in them? In a real consulting case, partners will push you to validate your assumptions with data.

Tell me more about why you think that's the right approach for this specific ${category || 'situation'}. What alternatives have you considered?`;
  }

  // ---- INTERVIEWER mode (user is interviewer, AI is candidate) ----
  if (isCandidate) {
    if (lower.includes('start') || lower.includes('begin') || lower.includes('case') || userMsgCount <= 1) {
      return `Thank you. Let me start by structuring my approach to this problem.

I'd like to use a three-part framework:
1. **External Analysis** — understanding the market dynamics, competitive landscape, and customer needs
2. **Internal Assessment** — evaluating the company's capabilities, resources, and constraints
3. **Strategic Options** — identifying and evaluating potential paths forward

Can I start by asking about the market size and growth rate for this ${category || 'industry'}?`;
    }

    if (lower.includes('framework') || lower.includes('structure') || lower.includes('approach')) {
      return `Great question. Here's my thinking on prioritization:

I'd start with the external analysis first because it sets the context. Specifically, I want to understand:
- **Market attractiveness**: Size, growth rate, profitability of the segment
- **Competitive dynamics**: Who are the key players, what's the concentration, what are the barriers to entry?
- **Customer needs**: What problems are they solving, what are their willingness-to-pay?

Once I have that context, I can assess whether the company has the right capabilities to win and then develop specific recommendations.`;
    }

    if (hasDataRequest) {
      const availableFacts = keyFacts.length > 0 ? keyFacts : [
        `The addressable market is $2.8B and growing at 18% CAGR`,
        `The company's current market share is 12%`,
        `Operating margins industry-wide are 22%`,
        `Customer acquisition cost runs $600 with LTV of $3,200`,
        `Top 3 competitors hold 58% combined market share`
      ];
      const fact = availableFacts[Math.floor(Math.random() * availableFacts.length)];
      return `Based on what I know: ${fact}

Can you also share data on the company's cost structure? Specifically, what are their fixed vs variable costs, and what's their current margin profile?`;
    }

    if (lower.includes('recommend') || lower.includes('solution') || lower.includes('conclusion')) {
      return `Based on my analysis, I recommend the following path forward:

**Recommendation**: Focus on the high-growth segment where the company has a clear competitive advantage in distribution.

**Rationale**: Our analysis shows this segment has 18% CAGR, 22% margins, and we have existing relationships with 60% of target customers.

**Key risks**: (1) Competitors may respond aggressively, (2) we'll need $50M in additional capital for the first 18 months, (3) talent acquisition in this space is competitive.

**Next steps**: Validate with customer surveys, build a financial model, and prepare a board presentation for Q3.

What are your thoughts on this direction?`;
    }

    return `Let me think about that systematically.

First, I'd break this down into a few key buckets:
1. What are the underlying drivers of the problem?
2. What data do we need to validate our hypotheses?
3. What are the likely scenarios and their implications?

Specifically for this ${category || 'situation'}, I'd want to understand the customer economics and competitive dynamics before jumping to solutions. Can you share any data on customer acquisition costs and lifetime value in this market?`;
  }

  // Fallback (shouldn't normally reach here)
  return `Thank you. Based on the case details, let me outline my structured approach.

I'll focus on three key areas:
1. Understanding the problem context and constraints
2. Analyzing the relevant data and market dynamics
3. Developing actionable recommendations with clear next steps

Where would you like me to start?`;
}





