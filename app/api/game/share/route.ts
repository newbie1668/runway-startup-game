import { NextResponse } from 'next/server';
import { fallbackShareText, type ShareSnapshot } from '@/lib/game/share';

export const runtime = 'nodejs';

function validSnapshot(value: unknown): value is ShareSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<ShareSnapshot>;
  const shortString = (candidate: unknown) =>
    typeof candidate === 'string' && candidate.trim().length > 0 && candidate.length <= 48;
  const boundedNumber = (candidate: unknown, max: number) =>
    typeof candidate === 'number' &&
    Number.isFinite(candidate) &&
    candidate >= 0 &&
    candidate <= max;
  return (
    shortString(snapshot.companyName) &&
    boundedNumber(snapshot.week, 10_000) &&
    (snapshot.phase === 'playing' ||
      snapshot.phase === 'dilemma' ||
      snapshot.phase === 'won' ||
      snapshot.phase === 'bankrupt' ||
      snapshot.phase === 'acquired') &&
    shortString(snapshot.stage) &&
    shortString(snapshot.sector) &&
    shortString(snapshot.hub) &&
    boundedNumber(snapshot.valuation, 10 ** 15) &&
    boundedNumber(snapshot.cash, 10 ** 15) &&
    boundedNumber(snapshot.traction, 10 ** 15) &&
    boundedNumber(snapshot.team, 100_000)
  );
}

function responseText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const output = (payload as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'output_text' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return null;
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin) {
    const requestHosts = new Set(
      [
        request.headers.get('host'),
        request.headers.get('x-forwarded-host'),
        new URL(request.url).host,
      ].filter(Boolean),
    );
    if (!requestHosts.has(new URL(origin).host)) {
      return NextResponse.json({ error: 'Cross-site request blocked.' }, { status: 403 });
    }
  }
  const body = await request.json().catch(() => null);
  const snapshot =
    body && typeof body === 'object' ? (body as { snapshot?: unknown }).snapshot : null;
  if (!validSnapshot(snapshot)) {
    return NextResponse.json({ error: 'Invalid game progress.' }, { status: 400 });
  }

  const fallback = fallbackShareText(snapshot);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ text: fallback, aiGenerated: false });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_SHARE_MODEL ?? 'gpt-5.6',
        instructions:
          'Write one energetic, human social post for a London startup strategy game. Use only the supplied facts. Keep it under 220 characters, include one friendly challenge to play, avoid hashtags, avoid marketing jargon, and do not invent results.',
        input: JSON.stringify(snapshot),
        max_output_tokens: 120,
        text: {
          format: {
            type: 'json_schema',
            name: 'runway_share_copy',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                text: { type: 'string', minLength: 30, maxLength: 220 },
              },
              required: ['text'],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const raw = responseText(await response.json());
    const generated = raw ? (JSON.parse(raw) as { text?: unknown }).text : null;
    if (typeof generated !== 'string' || generated.length > 220) throw new Error('Invalid AI copy');
    return NextResponse.json({ text: generated, aiGenerated: true });
  } catch {
    return NextResponse.json({ text: fallback, aiGenerated: false });
  }
}
