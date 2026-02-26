# Troubleshooting Guide

This document provides solutions for common issues encountered during wallet-based deployment integration.

---

## Quick Diagnosis

### Symptom → Solution Matrix

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| "Connect Wallet" button disabled | No connectors configured | Configure wallet provider with injected connector |
| Wallet connects but wrong chain shown | Chain not in provider config | Add chain to wallet provider configuration |
| 401 on API calls | Session expired | Implement token refresh flow |
| 403 on deploy | Missing CSRF or entitlement | Check CSRF header, verify Pro status |
| Job stuck in "running" | Backend processing | Wait longer, check backend logs |
| "Switch Network" button does nothing | Chain switch not awaited | Await the switchChain call |
| SSL certificate error on RPC | Wrong RPC URL | Use correct RPC URL from docs |
| Transaction fails after signing | Insufficient gas or funds | Check balance, increase gas limit |

---

## Wallet Connection Issues

### Problem: Connect Wallet Button Disabled

**Symptoms**:
- Button appears disabled/grayed out
- No wallet popup when clicking

**Causes**:
1. No wallet extension installed
2. Connectors array is empty
3. Wallet provider not initialized

**Solutions**:

1. **Verify wallet extension**:
   - Check MetaMask is installed and enabled
   - Check no other extensions are conflicting

2. **Check connector configuration**:
   - Ensure injected connector is configured
   - Verify wallet provider wraps the component

3. **Debug connectors**:
   - Log `connectors` array from useConnect
   - Should contain at least one connector

---

### Problem: Wallet Connects to Wrong Chain

**Symptoms**:
- Wallet shows connected but chain ID doesn't match
- "Switch Network" button appears unexpectedly

**Causes**:
1. Chain not configured in wallet provider
2. Wagmi/provider caching stale chain

**Solutions**:

1. **Add chain to provider config**:
   - Include target chain in chains array
   - Add transport for the chain

2. **Clear cached state**:
   - Disconnect wallet in MetaMask settings
   - Clear site data in browser
   - Reconnect wallet

---

### Problem: Chain Switch Does Nothing

**Symptoms**:
- Click "Switch Network" but nothing happens
- No MetaMask popup appears

**Causes**:
1. switchChain not properly awaited
2. Chain not configured in wallet provider
3. Error being silently caught

**Solutions**:

1. **Await the switch**:
   - Ensure switchChain is called with await
   - Handle the promise properly

2. **Add error handling**:
   - Catch and log switchChain errors
   - Check for error code 4902 (chain not added)

3. **Implement add chain fallback**:
   - If switch fails with 4902, call wallet_addEthereumChain
   - Provide full chain configuration

---

## API Issues

### Problem: 401 Unauthorized on Every Request

**Symptoms**:
- All API calls return 401
- User appears logged out

**Causes**:
1. Access token expired
2. Cookies not being sent
3. CORS issues

**Solutions**:

1. **Implement token refresh**:
   - On 401, call POST /u/auth/refresh
   - Retry original request after refresh

2. **Check cookie settings**:
   - Ensure `credentials: 'include'` in fetch
   - Verify cookies are set correctly

3. **Check CORS**:
   - Verify API allows your origin
   - Check for CORS errors in console

---

### Problem: 403 Forbidden on Deploy

**Symptoms**:
- Deploy request returns 403
- Other endpoints work fine

**Causes**:
1. Missing CSRF token
2. CSRF token mismatch
3. User lacks Pro entitlement

**Solutions**:

1. **Check CSRF token**:
   - Read csrf cookie value
   - Include as x-csrf-token header
   - Ensure values match

2. **Refresh CSRF**:
   - Reload page to get fresh CSRF cookie
   - Re-read cookie before request

3. **Check entitlement**:
   - Verify user has wallet_deployments entitlement
   - Check user's subscription status

---

### Problem: 502 Upstream Error

**Symptoms**:
- Deploy or status calls return 502
- Error mentions "upstream"

**Causes**:
1. EVI service is down
2. EVI service timeout
3. Network issues between services

**Solutions**:

1. **Retry with backoff**:
   - Wait 30 seconds
   - Retry the request
   - Max 3 retries

2. **Check service status**:
   - Verify EVI service is running
   - Check backend logs for details

---

## Deployment Flow Issues

### Problem: Job Stuck in "running" State

**Symptoms**:
- Polling continues indefinitely
- State never changes to pending_signature

**Causes**:
1. Contract generation taking long time
2. Backend worker stuck
3. Complex contract prompt

**Solutions**:

1. **Wait longer**:
   - Complex contracts take more time
   - Increase polling timeout to 3-5 minutes

2. **Simplify prompt**:
   - Try simpler contract description
   - Reduce complexity

3. **Check backend**:
   - Verify worker is processing
   - Check for errors in backend logs

---

### Problem: Session ID Not Found in Response

**Symptoms**:
- Job reaches pending_signature
- But sessionId is undefined

**Causes**:
1. Looking in wrong location
2. Response structure changed

**Solutions**:

1. **Check correct path**:
   - sessionId is at `response.data.result.sessionId`
   - NOT at `response.data.sessionId`

2. **Log full response**:
   - Console.log the entire response
   - Verify structure matches expectations

---

### Problem: Sign Session Returns 404

**Symptoms**:
- GET /wallet/sign/{sessionId} returns 404
- Session was just created

**Causes**:
1. Session ID incorrect
2. Session already expired
3. Session already used

**Solutions**:

1. **Verify session ID**:
   - Check sessionId matches exactly
   - No extra characters or encoding issues

2. **Check timing**:
   - Sessions expire after ~15 minutes
   - Restart deployment if expired

---

## Transaction Issues

### Problem: Transaction Rejected by Wallet

**Symptoms**:
- MetaMask shows error
- Transaction never sent

**Causes**:
1. Insufficient funds for gas
2. Invalid transaction parameters
3. Nonce issues

**Solutions**:

1. **Check balance**:
   - Verify user has enough CAMP for gas
   - Direct to faucet if needed

2. **Verify transaction params**:
   - Log transaction before sending
   - Check all fields are valid

---

### Problem: Transaction Sent but Never Confirms

**Symptoms**:
- Transaction hash received
- waitForReceipt never resolves

**Causes**:
1. Transaction stuck in mempool
2. Gas price too low
3. RPC not synced

**Solutions**:

1. **Check on explorer**:
   - Look up txHash on block explorer
   - See if pending or failed

2. **Increase gas**:
   - If stuck, may need higher gas price
   - Consider speed up in wallet

3. **Verify RPC**:
   - Ensure RPC is synced
   - Try different RPC endpoint

---

### Problem: SSL Certificate Error on RPC

**Symptoms**:
- `ERR_CERT_COMMON_NAME_INVALID`
- RPC calls fail

**Causes**:
1. Using wrong RPC URL
2. RPC endpoint has certificate issues

**Solutions**:

1. **Use correct RPC URL**:
   - Basecamp: `https://rpc.basecamp.t.raas.gelato.cloud`
   - NOT: `https://rpc.basecamp.t.conduit.xyz`

2. **Verify in browser**:
   - Open RPC URL in browser
   - Should not show certificate warning

---

## Hydration Errors (Next.js)

### Problem: Hydration Mismatch Warnings

**Symptoms**:
- Console shows hydration mismatch
- Mentions `bis_skin_checked` or extension attributes

**Causes**:
1. Browser extensions modifying DOM
2. SSR/client HTML mismatch

**Solutions**:

1. **Ignore if from extensions**:
   - These are caused by browser extensions
   - Not a real bug in your code
   - Won't appear for users without those extensions

2. **For real hydration issues**:
   - Use dynamic import with ssr: false for wallet components
   - Ensure wallet hooks only run client-side

---

## Debug Checklist

### Before Reporting an Issue

1. [ ] Check browser console for errors
2. [ ] Check network tab for failed requests
3. [ ] Verify wallet is connected
4. [ ] Verify correct chain
5. [ ] Check user has Pro entitlement
6. [ ] Try in incognito (no extensions)
7. [ ] Clear site data and retry
8. [ ] Check backend logs if accessible

### Information to Collect

- Browser and version
- Wallet extension and version
- Console errors (full text)
- Network request/response (sanitized)
- Current chain ID
- Job ID (if available)
- Session ID (if available)
