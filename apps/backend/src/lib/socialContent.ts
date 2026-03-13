// ============================================================================
// SOCIAL CONTENT GENERATOR — Two-Step Market Analysis Pipeline
// ============================================================================
// Step 1: Claude API (Haiku 4.5) → Deep analysis of market event
// Step 2: GPT-4o-mini → Format analysis into social media copy
//
// Cost per post: ~$0.005-0.01 (analysis) + ~$0.001 (formatting) = ~$0.006-0.011
// ============================================================================

// ---- Types ----------------------------------------------------------------

export interface MarketEvent {
  /** What happened — headline or description of the event */
  event: string;
  /** Optional: supporting data, price levels, percentages, dates */
  context?: string;
  /** Optional: specific tickers or sectors to focus on */
  tickers?: string[];
}

export interface MarketAnalysis {
  primaryInsight: string;
  affectedSectors: string[];
  specificImpacts: {
    what: string;
    why: string;
    magnitude: string;
  }[];
  levelsToWatch: {
    ticker: string;
    level: string;
    significance: string;
  }[];
  secondOrderEffect: string;
  contrarian: string;
  timeframe: string;
  riskToThesis: string;
}

export interface SocialContent {
  twitter: string;
  instagram: {
    hook: string;
    bullets: string[];
    cta: string;
  };
  tiktok: string;
}

// ---- Step 1: Deep Analysis (Claude API) -----------------------------------

const ANALYSIS_SYSTEM_PROMPT = `You are Atlas, a senior market strategist. Your job: dissect a market event into SPECIFIC, actionable intelligence for retail stock traders.

ANALYSIS MANDATE:
- Every insight MUST pass the "so what for price action?" test
- Name specific sectors, tickers, or asset classes — never say "the market" without specifying which part
- Quantify: percentage moves, dollar levels, date ranges, historical comparisons
- Find the second-order effect most traders will miss (the non-obvious downstream impact)
- Identify the contrarian angle — what is consensus getting wrong or ignoring?
- If a price level matters, name it with context (e.g. "SPY $540 = 200-day MA, acted as support 3 times in 2024")
- If you don't have a specific number, say so — never fabricate price levels

RESPONSE FORMAT — Return ONLY valid JSON matching this structure:
{
  "primaryInsight": "The single most important takeaway in one sentence",
  "affectedSectors": ["Specific sector or industry names"],
  "specificImpacts": [
    {
      "what": "The specific effect (e.g. 'semiconductor supply chain tightens')",
      "why": "The causal mechanism connecting event to effect",
      "magnitude": "Quantified or qualified size of impact (e.g. '3-5% margin compression expected')"
    }
  ],
  "levelsToWatch": [
    {
      "ticker": "Specific ticker symbol",
      "level": "Price level or range",
      "significance": "Why this level matters technically or fundamentally"
    }
  ],
  "secondOrderEffect": "The non-obvious downstream consequence most people will miss",
  "contrarian": "What the consensus view is getting wrong, or the overlooked angle",
  "timeframe": "When does this play out — days, weeks, quarters?",
  "riskToThesis": "What would invalidate this analysis"
}

No markdown. No preamble. No explanation outside JSON. If the event is vague, still extract maximum specificity from what's given.`;

export async function analyzeMarketEvent(event: MarketEvent): Promise<MarketAnalysis> {
  const userMessage = buildAnalysisUserMessage(event);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: userMessage },
      ],
      system: ANALYSIS_SYSTEM_PROMPT,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.content
    .filter((block: { type: string }) => block.type === 'text')
    .map((block: { text: string }) => block.text)
    .join('');

  const clean = text.replace(/```json\s*|```\s*/g, '').trim();
  return JSON.parse(clean) as MarketAnalysis;
}

function buildAnalysisUserMessage(event: MarketEvent): string {
  let msg = `EVENT: ${event.event}`;
  if (event.context) {
    msg += `\nCONTEXT: ${event.context}`;
  }
  if (event.tickers?.length) {
    msg += `\nFOCUS TICKERS: ${event.tickers.join(', ')}`;
  }
  return msg;
}

// ---- Step 2: Social Copy Formatting (GPT-4o-mini) -------------------------

const FORMATTING_SYSTEM_PROMPT = `You are Atlas, ChartSignl's market voice. Calm, direct, zero hype. You're the trader's sharp friend who cuts through noise.

You will receive a structured market analysis. Your ONLY job: convert it into three social media formats. Do NOT add new analysis or speculation. Use ONLY what's in the analysis.

FORMATTING RULES:

TWITTER (under 280 chars):
- Lead with the sharpest, most specific insight — not a summary
- Include one number, level, or ticker if the analysis provides one
- No emojis. No hashtags. No "Thread:" or "🧵"
- End with edge, not a question

INSTAGRAM (object with hook, bullets, cta):
- hook: One punchy sentence that creates urgency or curiosity. Under 15 words.
- bullets: Array of exactly 3 strings. Each bullet MUST follow this structure:
  "[Specific cause] → [Specific effect on price/sector/trader]"
  Never write a bullet that doesn't connect cause to effect.
- cta: One sentence. Reference ChartSignl naturally. Example: "Run your own levels on ChartSignl — Atlas breaks it down in seconds."

TIKTOK (15-20 second voiceover script):
- Open with a surprising fact, contrarian take, or "most people don't realize..." hook
- Middle: the sharpest 1-2 impacts from the analysis, spoken conversationally
- End with ONE specific thing to watch (a level, a date, a ticker)
- Write it as spoken word — short sentences, natural rhythm, no jargon dumps

RETURN ONLY valid JSON:
{
  "twitter": "string under 280 chars",
  "instagram": {
    "hook": "string",
    "bullets": ["string", "string", "string"],
    "cta": "string"
  },
  "tiktok": "string"
}

No markdown. No preamble. JSON only.`;

export async function formatSocialContent(analysis: MarketAnalysis): Promise<SocialContent> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY!}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      temperature: 0.7,
      messages: [
        { role: 'system', content: FORMATTING_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Here is the market analysis to format into social content:\n\n${JSON.stringify(analysis, null, 2)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.choices[0]?.message?.content ?? '';
  const clean = text.replace(/```json\s*|```\s*/g, '').trim();
  return JSON.parse(clean) as SocialContent;
}

// ---- Combined Pipeline ----------------------------------------------------

export interface GenerateResult {
  analysis: MarketAnalysis;
  content: SocialContent;
}

/**
 * Full pipeline: Analyze a market event → Generate social content
 */
export async function generateSocialContent(event: MarketEvent): Promise<GenerateResult> {
  const analysis = await analyzeMarketEvent(event);
  const content = await formatSocialContent(analysis);
  return { analysis, content };
}

// ---- Optional: All-Claude variant -----------------------------------------

export async function formatSocialContentClaude(analysis: MarketAnalysis): Promise<SocialContent> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: FORMATTING_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Here is the market analysis to format into social content:\n\n${JSON.stringify(analysis, null, 2)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const text = data.content
    .filter((block: { type: string }) => block.type === 'text')
    .map((block: { text: string }) => block.text)
    .join('');

  const clean = text.replace(/```json\s*|```\s*/g, '').trim();
  return JSON.parse(clean) as SocialContent;
}
