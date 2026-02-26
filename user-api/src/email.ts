import https from 'https';
import { env } from './env.js';

export type SendEmailParams = {
  toEmail: string;
  toName?: string;
  subject: string;
  htmlContent?: string;
  textContent?: string;
  params?: Record<string, any>;
  fromName?: string;
  fromEmail?: string;
  replyToEmail?: string;
  replyToName?: string;
};

export async function sendBrevoEmail({ toEmail, toName = 'User', subject, htmlContent, textContent, params, fromName, fromEmail, replyToEmail, replyToName }: SendEmailParams): Promise<void> {
  if (!env.BREVO_API_KEY) throw new Error('BREVO_API_KEY missing');

  const payload: any = {
    sender: { name: fromName ?? env.EMAIL_FROM_NAME, email: fromEmail ?? env.EMAIL_FROM_ADDRESS },
    to: [{ email: toEmail, name: toName }],
    subject,
    replyTo: { email: replyToEmail ?? env.EMAIL_REPLY_TO, name: replyToName ?? env.EMAIL_FROM_NAME },
    headers: {
      'X-Idempotency-Key': cryptoRandomId(),
    },
    tags: ['otp', 'auth'],
  };

  if (env.BREVO_TEMPLATE_ID_OTP) {
    payload.templateId = env.BREVO_TEMPLATE_ID_OTP;
    if (params) payload.params = params;
  } else {
    payload.htmlContent = htmlContent || '<p>Your verification code</p>';
    payload.textContent = textContent || 'Your verification code';
    if (params) payload.params = params; // supports {{params.*}} in content
  }

  const data = Buffer.from(JSON.stringify(payload));
  // structured log (info)
  try { console.log(JSON.stringify({ level: 'info', msg: 'email_send_attempt', provider: 'brevo', to: toEmail, subject })); } catch {}
  const options: https.RequestOptions = {
    method: 'POST',
    hostname: 'api.brevo.com',
    path: '/v3/smtp/email',
    headers: {
      'accept': 'application/json',
      'content-type': 'application/json',
      'api-key': env.BREVO_API_KEY,
      'content-length': data.length,
    },
  };

  await new Promise<void>((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks: any[] = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { console.log(JSON.stringify({ level: 'info', msg: 'email_send_success', provider: 'brevo', to: toEmail, status: res.statusCode })); } catch {}
          return resolve();
        }
        const body = Buffer.concat(chunks).toString('utf8');
        const err = new Error(`Brevo send failed: ${res.statusCode} ${body}`);
        try { console.error(JSON.stringify({ level: 'error', msg: 'email_send_failed', provider: 'brevo', to: toEmail, status: res.statusCode, body })); } catch {}
        reject(err);
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
