# Slack contact form webhook — Formspree alternative with AI spam filtering

Receive SmartForm webhook events and forward every new submission to a Slack channel
as a Block Kit message.

## How it works

```
Browser  →  SmartForm AI  →  POST this Vercel function  →  Slack incoming webhook
                                       │
                                       └─ verifies X-SmartForm-Signature
                                          before forwarding
```

1. Create a form in https://usesmartform.com/dashboard.
2. Set the form's **Webhook URL** to your deployed Vercel function URL
   (e.g. `https://smartform-slack.vercel.app/api/webhook`).
3. SmartForm posts every new submission to that URL (signed with HMAC-SHA256).
4. This function verifies the signature, builds a Slack Block Kit message, and forwards
   to Slack.

## Setup

1. Create a Slack incoming webhook: https://api.slack.com/messaging/webhooks → pick a
   channel → Copy URL.
2. Clone, install, configure, deploy:
   ```bash
   git clone https://github.com/yanghuai123456/smartform-example-webhook-slack.git
   cd smartform-example-webhook-slack
   npm install
   vercel link
   vercel env add SLACK_WEBHOOK_URL         # paste the URL from step 1
   vercel env add SMARTFORM_HMAC_SECRET     # from your SmartForm workspace settings
   vercel deploy --prod
   ```
3. In SmartForm dashboard, set the form's Webhook URL to
   `https://<your-deployment>.vercel.app/api/webhook`.

## The function

```ts
// api/webhook.ts — Vercel Edge Function
export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await req.text();

  if (!verifySignature(body, req.headers.get('X-SmartForm-Signature'))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(body);
  if (event.event !== 'submission.created') return new Response('ok', { status: 200 });

  const s = event.submission;
  const fields = Object.entries(s.data || {})
    .filter(([k]) => !k.startsWith('_'))
    .slice(0, 10)
    .map(([k, v]) => ({ type: 'mrkdwn', text: `*${k}*\n${String(v).slice(0, 800)}` }));

  const blocks = [
    { type: 'header', text: { type: 'plain_text',
        text: s.is_high_value ? '🔥 High-value lead' : (s.is_spam ? '🛡️ Spam submission' : 'New form submission') } },
    { type: 'section', text: { type: 'mrkdwn', text: s.ai_summary || '_(no AI summary)_' } },
    ...(fields.length ? [{ type: 'section', fields }] : []),
    { type: 'context', elements: [
        { type: 'mrkdwn', text: `form=\`${event.form.form_id}\`  intent=\`${s.intent_label}\` (${s.intent_confidence.toFixed(2)})  spam=${s.spam_confidence.toFixed(2)}` }] },
  ];

  await fetch(process.env.SLACK_WEBHOOK_URL!, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ blocks }),
  });

  return new Response('ok', { status: 200 });
}
```

`verifySignature()` is in `lib/verify.ts` — it recomputes HMAC-SHA256 with your shared
secret and compares it to the `X-SmartForm-Signature: sha256=<hex>` header.

## Webhook payload (from SmartForm)

```json
{
  "event": "submission.created",
  "submitted_at": "2026-09-28T07:54:00Z",
  "form": { "id": "...", "form_id": "f_abc12345", "name": "Contact form" },
  "submission": {
    "id": "sub_01HXX...",
    "data": { "name": "Ada", "email": "ada@example.com", "message": "Hi!" },
    "is_spam": false,
    "spam_confidence": 0.02,
    "intent_label": "sales",
    "intent_confidence": 0.93,
    "is_high_value": true,
    "ai_summary": "Visitor asks about pricing; mentions a 5-person team.",
    "ip_address": "203.0.113.5",
    "user_agent": "Mozilla/5.0 ..."
  }
}
```

Header: `X-SmartForm-Signature: sha256=<hmac_hex>`

## Local test

```bash
npx vercel dev
curl -X POST http://localhost:3000/api/webhook \
  -H 'Content-Type: application/json' \
  -H 'X-SmartForm-Signature: sha256=<compute locally with your secret>' \
  -d @sample-payload.json
```
## Related examples
[Discord webhook example](https://github.com/yanghuai123456/smartform-example-webhook-discord) | [SmartForm JS SDK](https://github.com/yanghuai123456/smartform-js)


## FAQ

### Why use this instead of Formspree?

Both SmartForm and Formspree let you POST a plain HTML form to a hosted
endpoint with no backend. SmartForm adds an AI spam filter (not just
honeypots), AI intent classification (`sales` / `support` / `inquiry`)
and high-value lead detection, with a free tier that includes the spam
filter. Formspree charges per submission; SmartForm's spam filter is
free on every plan.

### Is there a free tier?

Yes. AI spam filtering is enabled by default on every plan. AI intent
classification and high-value lead detection require a paid plan (Pro
or Business) — the dashboard enforces this and returns HTTP 402 if
you try to enable them on a free workspace.

### Do I need an API key?

No. The form posts directly to a public endpoint using only an 8-char
form ID, which is non-enumerable. The example also includes a hidden
`_gotcha` honeypot field so naive bots cannot submit.

### Does it verify the Slack signature?
No. This is a Slack-format *sender* (it POSTs to a Slack-compatible webhook after receiving a SmartForm event), not a Slack event receiver. For receiver-side verification, see the SmartForm docs.

## Related examples
[Discord webhook example](https://github.com/yanghuai123456/smartform-example-webhook-discord) | [SmartForm JS SDK](https://github.com/yanghuai123456/smartform-js)


## License

MIT.

