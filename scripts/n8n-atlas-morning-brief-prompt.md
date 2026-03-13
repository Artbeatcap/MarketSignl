# n8n Atlas Morning Brief — Claude prompt template

Use this prompt in your n8n workflow in the **Claude** node (or HTTP Request to Anthropic API). The previous step should provide `headlines` (e.g. from a Code node that formats Polygon news). In n8n you can pass it as the user message with the headlines variable.

---

## System prompt (optional — sets Atlas voice)

```
You are Atlas, ChartSignl's AI. You're writing the morning market brief for social. Use the same voice as our chart analysis: calm, confident, concise, risk-aware. No hype. No fabricated numbers or tickers — base everything only on the headlines provided.
```

---

## User prompt (use this in the node; replace the placeholder with your headlines input)

In n8n, set the **user message** to the following and inject the headlines from the previous node (e.g. `{{ $json.headlines }}` or the output of your Polygon + Code step):

```
Based on these market headlines, write three platform-specific posts for ChartSignl's morning brief. Use only the information in the headlines; do not invent tickers, numbers, or events.

Market context:
{{ $json.headlines }}

Return ONLY valid JSON with no other text, no markdown, no code fences. Use this exact structure:

{
  "twitter": "One punchy post under 280 characters. Direct tone, no emojis. Lead with the most important market takeaway.",
  "instagram": "A short hook line, then 3 bullet insights (one per line), then a single CTA line. No emojis unless the brand allows.",
  "tiktok": "A 15–20 second voiceover script. Conversational, like you're briefing a trader. 2–4 short sentences."
}

Rules:
- Twitter: under 280 chars, punchy, no emojis.
- Instagram: hook + 3 bullets + CTA; keep tone confident and clear.
- TikTok: natural spoken script, 15–20 seconds when read aloud.
- Do not fabricate any tickers, prices, or news. Only use what appears in the market context above.
- Return only the JSON object. No explanation before or after.
```

---

## n8n wiring

1. **Previous node**: HTTP Request to Polygon `/v2/reference/news` (e.g. `ticker=SPY&limit=10`) then a Code node that builds a string of top 5 headlines + one-line summaries. Output one item with a property `headlines` (string).
2. **This node**: Claude (or Anthropic) with the user prompt above. Reference the headlines from the previous node, e.g. in the message body use the expression that resolves to `headlines` (e.g. `{{ $('Code').item.json.headlines }}` or whatever your Code node is named).
3. **Next node**: Parse the JSON from Claude's response and send each of `twitter`, `instagram`, `tiktok` to Postiz (or split into three HTTP/Postiz nodes).

---

## OpenAI (gpt-4o-mini) variant

Use this if you prefer your existing **OPENAI_API_KEY** (no Anthropic key). Cost is negligible (~$0.03/month for one daily run). Model **gpt-4o-mini** is sufficient for summarizing headlines and writing social copy.

### Node: HTTP Request (OpenAI)

- **Method**: POST  
- **URL**: `https://api.openai.com/v1/chat/completions`  
- **Headers**:
  - `Authorization`: `Bearer {{ $env.OPENAI_API_KEY }}`
  - `Content-Type`: `application/json`
- **Body** (JSON): use the structure below. The user message must include the headlines from the previous node (e.g. `{{ $json.headlines }}` or `{{ $('Code').item.json.headlines }}` depending on your node names).

```json
{
  "model": "gpt-4o-mini",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "system",
      "content": "You are Atlas, ChartSignl's AI. You're writing the morning market brief for social. Use the same voice as our chart analysis: calm, confident, concise, risk-aware. No hype. No fabricated numbers or tickers — base everything only on the headlines provided."
    },
    {
      "role": "user",
      "content": "Based on these market headlines, write three platform-specific posts for ChartSignl's morning brief. Use only the information in the headlines; do not invent tickers, numbers, or events.\n\nMarket context:\n{{ $json.headlines }}\n\nReturn ONLY valid JSON with no other text, no markdown, no code fences. Use this exact structure:\n\n{\n  \"twitter\": \"One punchy post under 280 characters. Direct tone, no emojis.\",\n  \"instagram\": \"Hook line, then 3 bullet insights, then a CTA line.\",\n  \"tiktok\": \"A 15–20 second voiceover script. Conversational, 2–4 short sentences.\"\n}\n\nRules: Twitter under 280 chars, no emojis. Instagram: hook + 3 bullets + CTA. TikTok: natural spoken script. Do not fabricate tickers or news. Return only the JSON object."
    }
  ]
}
```

In n8n's HTTP Request node, set the **Body** to the JSON above and ensure the `content` of the user message uses the expression that points to your headlines (e.g. `{{ $json.headlines }}` if the previous node outputs one item with `headlines`).

### Node: Parse response (Code)

Place this Code node right after the HTTP Request. It reads the assistant message, strips markdown code fences if present, and outputs one item with `twitter`, `instagram`, `tiktok` for downstream Postiz nodes.

```javascript
const raw = $input.first().json.choices[0].message.content;
const clean = raw.replace(/```json|```/g, '').trim();
const posts = JSON.parse(clean);
return [{ json: posts }];
```

### Env: OPENAI_API_KEY in n8n

n8n must have `OPENAI_API_KEY` available so `{{ $env.OPENAI_API_KEY }}` works in the HTTP Request. Options:

- **Docker**: Add `OPENAI_API_KEY` to the n8n service in `apps/backend/deploy/docker-compose.yml` (see deploy docs). The key is then available as an env var in the container.
- **n8n UI**: In n8n Settings → Variables, add `OPENAI_API_KEY` and use it in the node as `{{ $env.OPENAI_API_KEY }}`.

---

## Example headlines input (for testing)

```
• SPY: S&P 500 futures flat after Fed hold; focus on jobs data Friday.
• NVDA: Chip giant reports earnings beat; guidance lifted on data center demand.
• BTC: Bitcoin holds above $62K as ETF flows stay positive.
• Fed: Powell signals one cut likely this year; data-dependent path.
• Oil: WTI dips on demand concerns; OPEC+ holds output steady.
```

Expected style of output: direct, no fluff, risk-aware where relevant, and strictly within the character and format rules for each platform.
