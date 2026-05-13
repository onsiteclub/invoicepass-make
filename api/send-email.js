// Vercel serverless function — POST /api/send-email
//
// Sends an invoice PDF by email via Resend. The PDF is generated client-side
// by make/index.html; this function is purely a courier so the Resend API
// key never leaves the server.
//
// Required env vars (Vercel project settings):
//   RESEND_API_KEY       — Resend API key (server-side)
//   TURNSTILE_SECRET_KEY — Cloudflare Turnstile secret to verify the token
//                          (use 1x0000000000000000000000000000000AA for dev:
//                          always passes; pair with the test site key in
//                          index.html)
//   EMAIL_FROM           — verified Resend sender (e.g.
//                          "InvoicePass <invoices@make.invoicepass.app>")
//
// Request body:
//   {
//     to_email: string,
//     pdf_base64: string,
//     turnstile_token: string,
//     invoice_number?: string,
//     total?: number,
//     sender_email?: string,   // becomes Reply-To
//     sender_name?: string,
//   }
//
// Response:
//   200 { ok: true, id }
//   400/401/429/500 { ok: false, error }

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Lightweight in-memory rate limit per IP. Vercel may spin up multiple
// function instances under heavy load, so the actual ceiling is N×limit —
// fine for a 100-user demo. For production scale, replace with Upstash.
const ipBuckets = new Map(); // ip -> { count, resetAt }
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function rateLimit(ip) {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    ipBuckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= MAX_PER_WINDOW) return false;
  bucket.count += 1;
  return true;
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false;
  const params = new URLSearchParams();
  params.append('secret', secret);
  params.append('response', token);
  if (remoteIp) params.append('remoteip', remoteIp);
  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: 'POST',
    body: params,
  });
  if (!res.ok) return false;
  const data = await res.json();
  return !!data.success;
}

function isValidEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function fmtCurrency(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return 'CAD ' + n.toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'object' && req.body !== null
      ? req.body
      : JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid_json' });
  }

  const {
    to_email,
    pdf_base64,
    turnstile_token,
    invoice_number,
    total,
    sender_email,
    sender_name,
  } = body;

  if (!isValidEmail(to_email)) {
    return res.status(400).json({ ok: false, error: 'invalid_to_email' });
  }
  if (typeof pdf_base64 !== 'string' || pdf_base64.length < 100) {
    return res.status(400).json({ ok: false, error: 'invalid_pdf' });
  }
  if (typeof turnstile_token !== 'string' || !turnstile_token) {
    return res.status(400).json({ ok: false, error: 'missing_turnstile_token' });
  }

  const ip = getClientIp(req);
  if (!rateLimit(ip)) {
    return res.status(429).json({ ok: false, error: 'rate_limited' });
  }

  const turnstileOk = await verifyTurnstile(turnstile_token, ip);
  if (!turnstileOk) {
    return res.status(401).json({ ok: false, error: 'turnstile_failed' });
  }

  // Decode and sniff PDF magic bytes
  let pdfBuffer;
  try {
    pdfBuffer = Buffer.from(pdf_base64, 'base64');
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid_pdf_base64' });
  }
  if (pdfBuffer.length === 0 || pdfBuffer.length > 5 * 1024 * 1024) {
    return res.status(400).json({ ok: false, error: 'pdf_size_out_of_range' });
  }
  if (pdfBuffer.slice(0, 5).toString('ascii') !== '%PDF-') {
    return res.status(400).json({ ok: false, error: 'not_a_pdf' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return res.status(500).json({ ok: false, error: 'email_not_configured' });
  }
  const fromAddress =
    process.env.EMAIL_FROM ||
    'InvoicePass <invoices@make.invoicepass.app>';

  const subjectParts = ['Invoice'];
  if (invoice_number) subjectParts.push(invoice_number);
  if (typeof total === 'number') subjectParts.push(fmtCurrency(total));
  if (sender_name) subjectParts.push('from ' + sender_name);
  const subject = subjectParts.join(' ');

  const greeting = sender_name
    ? `${sender_name} sent you an invoice via InvoicePass.`
    : 'You have a new invoice via InvoicePass.';

  const filename = (invoice_number || 'invoice').replace(/[^a-zA-Z0-9_-]+/g, '_') + '.pdf';

  const resendPayload = {
    from: fromAddress,
    to: [to_email],
    subject,
    text:
      greeting + '\n\n' +
      (invoice_number ? 'Invoice: ' + invoice_number + '\n' : '') +
      (typeof total === 'number' ? 'Total: ' + fmtCurrency(total) + '\n' : '') +
      '\nThe full invoice is attached as a PDF.\n' +
      '\n— make.invoicepass.app',
    attachments: [
      {
        filename,
        content: pdfBuffer.toString('base64'),
      },
    ],
  };
  if (isValidEmail(sender_email)) {
    resendPayload.reply_to = sender_email;
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(resendPayload),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('[send-email] Resend rejected', resp.status, data);
    return res.status(502).json({
      ok: false,
      error: data?.message || ('resend_http_' + resp.status),
    });
  }

  return res.status(200).json({ ok: true, id: data.id });
};
