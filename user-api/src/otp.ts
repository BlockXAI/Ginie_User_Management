import { redis } from './redis.js';
import { sendBrevoEmail } from './email.js';
import { env } from './env.js';
import { randomToken, tokenHash } from './utils.js';

export interface OtpProvider {
  createChallenge(
    identity: string,
    opts?: { name?: string; fromName?: string; fromEmail?: string; replyToEmail?: string; replyToName?: string }
  ): Promise<{ challengeId: string; expiresAt?: number; otp?: string }>
  verify(identity: string, otp: string, challengeId?: string): Promise<{ ok: boolean; reason?: string }>
}

// Development provider: stores code per-identity, logs code to console
function keyForDev(identity: string) {
  return `otp:dev:${identity.toLowerCase()}`;
}

export class DevOtpProvider implements OtpProvider {
  async createChallenge(identity: string, _opts?: { name?: string }) {
    const code = sixDigit();
    const k = keyForDev(identity);
    await redis.set(k, code, 'EX', 600); // 10 minutes
    return { challengeId: k, expiresAt: Date.now() + 600_000, otp: code };
  }
  async verify(identity: string, otp: string) {
    const k = keyForDev(identity);
    const stored = await redis.get(k);
    if (stored && stored === otp) {
      await redis.del(k);
      return { ok: true };
    }
    return { ok: false, reason: 'mismatch' };
  }
}

// Stateful provider: keeps a short-lived challenge in Redis and delivers OTP via Brevo
// Keys
const CH_TTL_SEC = 600; // 10 minutes
const CH_MAX_ATTEMPTS = 5;
function chKey(id: string) { return `otp:ch:${id}`; }

export class StatefulOtpProvider implements OtpProvider {
  async createChallenge(identity: string, opts?: { name?: string; fromName?: string; fromEmail?: string; replyToEmail?: string; replyToName?: string }) {
    const email = identity.trim().toLowerCase();
    const challengeId = randomToken(16);
    const code = sixDigit();
    const otp_hash = hashOtp(email, code);
    const record = {
      identity: email,
      otp_hash,
      status: 'active',
      purpose: 'login',
      attempts: 0,
      exp: Date.now() + CH_TTL_SEC * 1000,
    };
    await redis.set(chKey(challengeId), JSON.stringify(record), 'EX', CH_TTL_SEC);

    // Deliver via Brevo with professional email template
    const subject = `${code} is your Ginie verification code`;
    const userName = opts?.name || email.split('@')[0] || 'there';
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Your Ginie Verification Code</title>
</head>
<body style="margin:0;padding:0;background-color:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#000000;">
    <tr>
      <td style="padding:40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:520px;margin:0 auto;">
          <!-- Logo & Header -->
          <tr>
            <td style="text-align:center;padding-bottom:32px;">
              <div style="display:inline-block;background:linear-gradient(135deg,#ff6d01 0%,#ff8c00 100%);border-radius:16px;padding:14px 22px;">
                <span style="font-size:28px;font-weight:800;color:#000000;letter-spacing:-0.5px;">Ginie</span>
              </div>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:linear-gradient(180deg,#0b0b0f 0%,#050506 100%);border-radius:24px;border:1px solid rgba(255,255,255,0.08);box-shadow:0 25px 50px -12px rgba(0,0,0,0.65);">
                <tr>
                  <td style="padding:48px 40px;">
                    <!-- Greeting -->
                    <p style="margin:0 0 8px 0;font-size:12px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:1.8px;font-weight:700;">One-time passcode</p>
                    <h1 style="margin:0 0 18px 0;font-size:28px;font-weight:800;color:#ffffff;line-height:1.25;">Verify your sign-in</h1>

                    <!-- Message -->
                    <p style="margin:0 0 32px 0;font-size:16px;color:rgba(255,255,255,0.7);line-height:1.6;">
                      Hi ${userName}, use the code below to complete your Ginie sign-in.
                    </p>

                    <!-- OTP Code Box -->
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td style="background:linear-gradient(135deg,rgba(255,109,1,0.16) 0%,rgba(255,140,0,0.10) 100%);border:2px solid rgba(255,109,1,0.30);border-radius:16px;padding:28px;text-align:center;">
                          <p style="margin:0 0 12px 0;font-size:12px;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:2px;font-weight:700;">Your verification code</p>
                          <p style="margin:0;font-size:42px;font-weight:900;color:#ffffff;letter-spacing:10px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${code}</p>
                        </td>
                      </tr>
                    </table>

                    <!-- Timer -->
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:24px;">
                      <tr>
                        <td style="text-align:center;">
                          <span style="display:inline-block;background:rgba(255,109,1,0.10);border:1px solid rgba(255,109,1,0.22);border-radius:20px;padding:8px 16px;font-size:13px;color:#ff8c00;font-weight:600;">
                            Expires in 10 minutes
                          </span>
                        </td>
                      </tr>
                    </table>

                    <!-- CTA -->
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:28px;">
                      <tr>
                        <td style="text-align:center;">
                          <a href="https://ginie.xyz" target="_blank" rel="noopener noreferrer"
                            style="display:inline-block;background:linear-gradient(135deg,#ff6d01 0%,#ff8c00 100%);color:#000000;text-decoration:none;font-weight:800;font-size:14px;letter-spacing:0.2px;padding:12px 18px;border-radius:14px;">
                            Continue to Ginie
                          </a>
                        </td>
                      </tr>
                    </table>

                    <!-- Security Notice -->
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:32px;background:rgba(255,255,255,0.03);border-radius:12px;padding:20px;">
                      <tr>
                        <td style="padding:20px;">
                          <p style="margin:0 0 8px 0;font-size:13px;font-weight:600;color:rgba(255,255,255,0.8);">🔒 Security tip</p>
                          <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.5);line-height:1.5;">
                            Never share this code with anyone. Ginie staff will never ask for your verification code.
                          </p>
                        </td>
                      </tr>
                    </table>

                    <!-- Social -->
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="margin-top:20px;">
                      <tr>
                        <td style="text-align:center;">
                          <a href="https://www.instagram.com/ginie.xyz" target="_blank" rel="noopener noreferrer"
                            style="display:inline-block;margin:0 6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:999px;padding:8px 12px;color:rgba(255,255,255,0.8);text-decoration:none;font-size:12px;font-weight:700;">
                            IG
                          </a>
                          <a href="https://x.com/giniedotxyz" target="_blank" rel="noopener noreferrer"
                            style="display:inline-block;margin:0 6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:999px;padding:8px 12px;color:rgba(255,255,255,0.8);text-decoration:none;font-size:12px;font-weight:700;">
                            X
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:32px;text-align:center;">
              <p style="margin:0 0 8px 0;font-size:13px;color:rgba(255,255,255,0.4);">
                Didn't request this code? You can safely ignore this email.
              </p>
              <p style="margin:0;font-size:12px;color:rgba(255,255,255,0.3);">
                © ${new Date().getFullYear()} Ginie
              </p>
              <p style="margin:10px 0 0 0;font-size:11px;color:rgba(255,255,255,0.22);">ginie.xyz</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
    const text = `Hi ${userName}!

Use the code below to complete your Ginie sign-in.

Your verification code: ${code}

This code expires in 10 minutes and can only be used once.

Security tip: Never share this code with anyone. Ginie staff will never ask for your verification code.

Didn't request this code? You can safely ignore this email.

Continue: https://ginie.xyz

Instagram: @ginie.xyz
X: @giniedotxyz

© ${new Date().getFullYear()} Ginie`;
    try {
      await sendBrevoEmail({
        toEmail: email,
        toName: opts?.name || email,
        subject,
        htmlContent: html,
        textContent: text,
        params: { otp: code, ttlMinutes: 10, appDomain: 'ginie.xyz', appUrl: 'https://ginie.xyz' },
        fromName: opts?.fromName,
        fromEmail: opts?.fromEmail,
        replyToEmail: opts?.replyToEmail,
        replyToName: opts?.replyToName,
      });
    } catch (e) {
      // If delivery fails, we can choose to delete the challenge to avoid stranded records
      await redis.del(chKey(challengeId));
      throw e;
    }

    return { challengeId, expiresAt: record.exp };
  }

  async verify(identity: string, otp: string, challengeId?: string) {
    if (!challengeId) return { ok: false, reason: 'missing_challenge' };
    const key = chKey(challengeId);
    const s = await redis.get(key);
    if (!s) return { ok: false, reason: 'expired' };
    let rec: any;
    try { rec = JSON.parse(s); } catch { return { ok: false, reason: 'invalid_state' }; }
    if (rec.status !== 'active') return { ok: false, reason: 'replayed' };
    if (Date.now() > Number(rec.exp)) return { ok: false, reason: 'expired' };
    if ((rec.attempts ?? 0) >= CH_MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
    const email = identity.trim().toLowerCase();
    if (rec.identity !== email) return { ok: false, reason: 'mismatch_identity' };
    const ok = rec.otp_hash === hashOtp(email, otp);
    if (!ok) {
      rec.attempts = (rec.attempts ?? 0) + 1;
      await redis.set(key, JSON.stringify(rec), 'EX', Math.max(1, Math.floor((Number(rec.exp) - Date.now()) / 1000)));
      return { ok: false, reason: 'mismatch' };
    }
    // Mark used and shorten TTL to a small value to prevent replay
    rec.status = 'used';
    await redis.set(key, JSON.stringify(rec), 'EX', 60);
    return { ok: true };
  }
}

function sixDigit() {
  return (Math.floor(Math.random() * 900000) + 100000).toString();
}

function hashOtp(identity: string, code: string) {
  // Bind OTP to identity to avoid swapping challenges across identities
  return tokenHash(`${identity}|${code}`);
}
