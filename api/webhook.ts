// api/webhook.ts — Vercel Edge Function. Forwards SmartForm submissions to Slack.
import type { NextRequest } from 'next/server';
import { verifySignature } from '../lib/verify';

export const config = { runtime: 'edge' };

interface SmartFormPayload {
  event: 'submission.created';
  submitted_at: string;
  form:    { id: string; form_id: string; name: string };
  submission: {
    id: string;
    data: Record<string, unknown>;
    is_spam: boolean;
    spam_confidence: number;
    intent_label: string;
    intent_confidence: number;
    is_high_value: boolean;
    ai_summary: string;
  };
}

export default async function handler(req: NextRequest) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const body   = await req.text();
  const sig    = req.headers.get('X-SmartForm-Signature');
  const secret = process.env.SMARTFORM_HMAC_SECRET || '';
  const slack  = process.env.SLACK_WEBHOOK_URL;

  if (!slack)                  return new Response('SLACK_WEBHOOK_URL not set', { status: 500 });
  if (!verifySignature(body, sig, secret)) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event: SmartFormPayload = JSON.parse(body);
  if (event.event !== 'submission.created') return new Response('ok', { status: 200 });

  const s = event.submission;
  const fields = Object.entries(s.data || {})
    .filter(([k]) => !k.startsWith('_'))
    .slice(0, 10)
    .map(([k, v]) => ({ type: 'mrkdwn', text: `*${k}*\n${String(v).slice(0, 800)}` }));

  const blocks: any[] = [
    { type: 'header', text: {
        type: 'plain_text',
        text: s.is_high_value ? '🔥 High-value lead' : (s.is_spam ? '🛡️ Spam submission' : 'New form submission'),
    } },
    { type: 'section', text: { type: 'mrkdwn', text: s.ai_summary || '_(no AI summary)_' } },
    ...(fields.length ? [{ type: 'section', fields }] : []),
    { type: 'context', elements: [{
        type: 'mrkdwn',
        text: `form=\`${event.form.form_id}\`  intent=\`${s.intent_label}\` (${s.intent_confidence.toFixed(2)})  spam=${s.spam_confidence.toFixed(2)}`,
    }] },
  ];

  const r = await fetch(slack, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ blocks }),
  });

  if (!r.ok) return new Response(`Slack ${r.status}: ${await r.text()}`, { status: 502 });
  return new Response('ok', { status: 200 });
}
