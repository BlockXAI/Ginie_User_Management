# Security Considerations

This document covers security best practices for wallet-based deployment integration.

---

## Authentication Security

### Cookie-Based Authentication

The wrapper API uses HTTP-only cookies for authentication:

| Cookie | Purpose | Security Features |
|--------|---------|-------------------|
| `access_token` | Short-lived JWT | HttpOnly, Secure, SameSite=Lax |
| `refresh_token` | Long-lived JWT | HttpOnly, Secure, SameSite=Lax |
| `csrf` | CSRF protection | SameSite=Lax |

### Why HTTP-Only Cookies?

- **Cannot be accessed by JavaScript**: Prevents XSS attacks from stealing tokens
- **Automatically sent with requests**: No manual token handling needed
- **Secure flag**: Only sent over HTTPS in production

### Token Refresh Flow

1. Access token expires (short-lived, ~15 minutes)
2. API returns 401 Unauthorized
3. Frontend calls POST /u/auth/refresh
4. New access token issued via cookie
5. Original request retried

---

## CSRF Protection

### Double-Submit Cookie Pattern

The API uses double-submit cookies for CSRF protection:

1. Server sets `csrf` cookie on authentication
2. Frontend reads cookie value
3. Frontend includes value in `x-csrf-token` header
4. Server validates header matches cookie

### Implementation Requirements

For all POST requests to wallet endpoints:

```
Headers:
  x-csrf-token: <value from csrf cookie>
```

### Why CSRF Protection Matters

Without CSRF protection, a malicious site could:
- Trigger deployments on behalf of users
- Submit transactions without user consent
- Consume user's rate limits

---

## Wallet Security

### Never Handle Private Keys

The wallet-based deployment flow is designed so that:

- **Private keys never leave the wallet**
- **Backend never sees private keys**
- **Frontend never sees private keys**

The flow uses unsigned transactions that the wallet signs locally.

### Transaction Verification

Before signing, users should verify in their wallet:

| Field | What to Check |
|-------|---------------|
| To | Should be `null` or empty (contract creation) |
| Value | Should be `0` unless sending ETH |
| Network | Should match expected network |
| Gas | Should be reasonable for contract deployment |

### Wallet Connection Best Practices

1. **Only request necessary permissions**: Just account access
2. **Don't auto-connect**: Let user initiate connection
3. **Show connected address**: User should see which account is connected
4. **Allow disconnection**: User should be able to disconnect easily

---

## Data Security

### Sensitive Data Handling

| Data Type | Storage | Transmission |
|-----------|---------|--------------|
| Wallet address | Memory only | HTTPS only |
| Transaction hash | Memory, display | HTTPS only |
| Session ID | Memory only | HTTPS only |
| Contract code | Not stored client-side | HTTPS only |

### What NOT to Store

Never store in localStorage, sessionStorage, or cookies:

- Private keys (never accessible anyway)
- Session IDs
- Full transaction data
- Contract source code

### What's Safe to Store

Can be stored temporarily in memory:

- Connected wallet address
- Current chain ID
- Job ID (for polling)
- Transaction hash (for display)

---

## API Security

### Rate Limiting

Rate limits protect against:

- Denial of service attacks
- Resource exhaustion
- Abuse of AI generation

| Endpoint | Limit | Window |
|----------|-------|--------|
| Deploy | 10 | 15 min |
| Job status | 100 | 15 min |
| Sign session | 100 | 15 min |
| Submit | 20 | 15 min |

### Entitlement Checking

Wallet deployment requires Pro entitlement:

- Checked on every request
- Cannot be bypassed client-side
- Enforced at API layer

### Request Validation

All requests are validated:

- Schema validation (required fields, types)
- Format validation (addresses, hashes)
- Size limits (prompt length)

---

## Session Security

### Signing Session Expiry

Signing sessions have a limited lifetime:

- Sessions expire after a set time (typically 10-15 minutes)
- Expired sessions cannot be used to sign
- New deployment required after expiry

### Session Isolation

Each session is:

- Tied to a specific job
- Tied to a specific wallet address
- Single-use (cannot resubmit same session)

---

## Network Security

### HTTPS Only

All API communication must use HTTPS:

- Encrypts data in transit
- Prevents man-in-the-middle attacks
- Required for Secure cookies

### RPC Security

When configuring RPC endpoints:

- Use official RPC URLs only
- Verify SSL certificates
- Don't use HTTP (unencrypted) RPCs

### Trusted RPC URLs

| Chain | Trusted RPC |
|-------|-------------|
| Basecamp | `https://rpc.basecamp.t.raas.gelato.cloud` |
| Camp Network | `https://rpc.camp-network-testnet.gelato.digital` |

---

## Frontend Security

### Input Validation

Validate all user inputs before sending:

| Input | Validation |
|-------|------------|
| Prompt | Non-empty, reasonable length |
| Wallet address | Valid Ethereum address format |
| Network | From allowed list |

### Output Encoding

When displaying data from API:

- Escape HTML in error messages
- Validate URLs before creating links
- Don't execute any returned code

### Content Security Policy

Recommended CSP headers:

```
Content-Security-Policy:
  default-src 'self';
  connect-src 'self' https://rpc.basecamp.t.raas.gelato.cloud;
  script-src 'self';
```

---

## Common Attack Vectors

### Phishing Prevention

Protect users from phishing:

- Show connected wallet address prominently
- Display network name before signing
- Warn if network seems wrong

### Replay Attack Prevention

Sessions are protected against replay:

- Each session has unique ID
- Sessions are single-use
- Sessions expire after timeout

### Front-Running Prevention

Contract deployment transactions:

- Are sent directly from user's wallet
- Go through standard mempool
- No special front-running protection needed (deployment, not trading)

---

## Audit Checklist

### Before Production

- [ ] All API calls use HTTPS
- [ ] CSRF token included in POST requests
- [ ] Tokens stored in HTTP-only cookies
- [ ] Rate limiting implemented
- [ ] Entitlement checking enforced
- [ ] Input validation on all fields
- [ ] Error messages don't leak sensitive info
- [ ] Wallet address displayed to user
- [ ] Network name displayed before signing
- [ ] Session expiry handled gracefully

### Regular Checks

- [ ] Dependencies updated
- [ ] RPC endpoints still valid
- [ ] Rate limits appropriate
- [ ] Error logging working
- [ ] No sensitive data in logs

---

## Incident Response

### If Tokens Compromised

1. Revoke all sessions for affected users
2. Force re-authentication
3. Investigate access logs
4. Notify affected users

### If API Abuse Detected

1. Identify source (user, IP)
2. Apply temporary block
3. Investigate pattern
4. Adjust rate limits if needed

### If Wallet Compromise Suspected

User-side issue, but provide guidance:

1. Advise user to revoke site permissions
2. Suggest checking wallet transaction history
3. Recommend wallet security review
