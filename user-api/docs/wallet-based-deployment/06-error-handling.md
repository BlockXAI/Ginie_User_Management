# Error Handling

This document covers error handling strategies for wallet-based deployment integration.

---

## Error Categories

### 1. API Errors

Errors returned by the wrapper API endpoints.

### 2. Wallet Errors

Errors from the user's Web3 wallet (MetaMask, etc.).

### 3. Network Errors

Connection and RPC-related errors.

### 4. Business Logic Errors

Errors from contract generation, compilation, or deployment.

---

## API Error Responses

### Standard Error Format

All API errors follow this structure:

```
{
  "ok": false,
  "error": {
    "code": "error_code",
    "detail": "Human-readable description"
  }
}
```

### Error Codes Reference

| Code | HTTP Status | Description | User Action |
|------|-------------|-------------|-------------|
| `unauthorized` | 401 | Session expired or invalid | Redirect to login |
| `forbidden` | 403 | Missing entitlement or CSRF | Check Pro status, refresh page |
| `bad_request` | 400 | Invalid request parameters | Fix input and retry |
| `not_found` | 404 | Resource not found | Check IDs, may need to restart |
| `rate_limited` | 429 | Too many requests | Wait and retry |
| `upstream_error` | 502 | EVI service error | Retry later |
| `internal_error` | 500 | Server error | Retry later |

---

## Handling API Errors

### 401 Unauthorized

**Cause**: Access token expired or invalid

**Detection**: HTTP status 401 or `error.code === "unauthorized"`

**Handling**:
1. Attempt token refresh (POST /u/auth/refresh)
2. If refresh succeeds, retry original request
3. If refresh fails, redirect to login page

**User Message**: "Your session has expired. Please sign in again."

---

### 403 Forbidden

**Causes**:
- Missing CSRF token
- Invalid CSRF token
- Missing Pro entitlement

**Detection**: HTTP status 403 or `error.code === "forbidden"`

**Handling**:
1. Check if CSRF token is present in request
2. Refresh page to get new CSRF token
3. Check user's entitlements

**User Messages**:
- CSRF issue: "Please refresh the page and try again."
- Entitlement issue: "Wallet deployment requires a Pro subscription."

---

### 429 Rate Limited

**Cause**: Too many requests in time window

**Detection**: HTTP status 429 or `error.code === "rate_limited"`

**Handling**:
1. Stop current operation
2. Show rate limit message
3. Implement exponential backoff for retries

**User Message**: "You've made too many requests. Please wait a moment before trying again."

**Retry Strategy**:
- Wait 30 seconds before first retry
- Double wait time for subsequent retries
- Max 3 retry attempts

---

### 502 Upstream Error

**Cause**: EVI service unavailable or error

**Detection**: HTTP status 502 or `error.code === "upstream_error"`

**Handling**:
1. Log error details for debugging
2. Show service unavailable message
3. Offer retry option

**User Message**: "The contract generation service is temporarily unavailable. Please try again in a few minutes."

---

## Wallet Errors

### Error Code Reference

| Code | Name | Description |
|------|------|-------------|
| 4001 | User Rejected | User cancelled the request |
| 4100 | Unauthorized | Requested method not authorized |
| 4200 | Unsupported | Method not supported |
| 4900 | Disconnected | Provider disconnected |
| 4901 | Chain Disconnected | Chain disconnected |
| 4902 | Chain Not Added | Requested chain not in wallet |
| -32002 | Request Pending | Request already pending |
| -32603 | Internal Error | Wallet internal error |

---

### 4001 User Rejected

**Cause**: User clicked "Reject" in wallet popup

**Handling**:
1. Return to previous state (ready to sign)
2. Keep session data intact
3. Allow user to try again

**User Message**: "Transaction cancelled. Click 'Sign & Deploy' to try again."

---

### 4902 Chain Not Added

**Cause**: Requested chain not configured in wallet

**Handling**:
1. Catch the error
2. Call `wallet_addEthereumChain` with chain config
3. After adding, retry the switch

**User Message**: "Adding Basecamp network to your wallet..."

---

### -32002 Request Pending

**Cause**: Previous wallet request still awaiting user action

**Handling**:
1. Show message about pending request
2. Instruct user to check wallet
3. Don't send duplicate requests

**User Message**: "Please check your wallet for a pending request."

---

### Insufficient Funds

**Cause**: User doesn't have enough native token for gas

**Detection**: Error message contains "insufficient funds"

**Handling**:
1. Show clear message about needing gas
2. Provide faucet link for testnet

**User Message**: "Insufficient CAMP for gas fees. Get testnet tokens from the faucet."

**Faucet Link**: `https://www.campnetwork.xyz/faucet_l1`

---

## Network Errors

### Connection Timeout

**Cause**: Network request timed out

**Detection**: Error type is network error or timeout

**Handling**:
1. Retry with exponential backoff
2. After 3 retries, show error
3. Check internet connection

**User Message**: "Connection timed out. Please check your internet connection."

---

### RPC Errors

**Cause**: Blockchain RPC endpoint issues

**Common RPC Errors**:

| Error | Cause | Solution |
|-------|-------|----------|
| `ERR_CERT_COMMON_NAME_INVALID` | SSL certificate mismatch | Use correct RPC URL |
| Connection refused | RPC endpoint down | Try alternative RPC |
| Rate limited | Too many RPC calls | Reduce polling frequency |

---

## Contract Generation Errors

### Compilation Failed

**Cause**: Generated Solidity code has errors

**Detection**: Job state is `failed` with compilation error

**Example Errors**:
- "incorrect number of arguments to constructor"
- "undeclared identifier"
- "type mismatch"

**Handling**:
1. Extract error message from job status
2. Show specific error to user
3. Suggest modifying prompt

**User Message**: "Contract compilation failed: [specific error]. Try rephrasing your request."

---

### Generation Timeout

**Cause**: AI generation took too long

**Detection**: Polling timeout exceeded

**Handling**:
1. Stop polling
2. Show timeout message
3. Offer to retry

**User Message**: "Contract generation is taking longer than expected. Would you like to continue waiting or try again?"

---

## Error Recovery Strategies

### Retry Matrix

| Error Type | Retry? | Max Retries | Backoff |
|------------|--------|-------------|---------|
| 401 Unauthorized | Yes (with refresh) | 1 | None |
| 403 Forbidden | No | - | - |
| 429 Rate Limited | Yes | 3 | Exponential |
| 502 Upstream | Yes | 3 | Linear (30s) |
| Network Error | Yes | 3 | Exponential |
| User Rejected | Manual | - | - |
| Compilation Failed | Manual (new prompt) | - | - |

### Exponential Backoff

```
attempt 1: wait 1 second
attempt 2: wait 2 seconds
attempt 3: wait 4 seconds
attempt 4: wait 8 seconds
...
```

### Linear Backoff

```
attempt 1: wait 30 seconds
attempt 2: wait 30 seconds
attempt 3: wait 30 seconds
```

---

## User-Facing Error Messages

### Best Practices

1. **Be specific**: Tell user what went wrong
2. **Be actionable**: Tell user what to do next
3. **Be reassuring**: Don't blame the user
4. **Provide options**: Retry, cancel, get help

### Message Templates

| Scenario | Message |
|----------|---------|
| Session expired | "Your session has expired. Please sign in again to continue." |
| No Pro access | "Wallet deployment is a Pro feature. Upgrade to access this feature." |
| Rate limited | "Please wait a moment before trying again." |
| Service down | "The service is temporarily unavailable. Please try again later." |
| Compilation error | "Contract generation failed: [error]. Try a different description." |
| User rejected | "Transaction cancelled. Click 'Sign & Deploy' when ready." |
| Insufficient funds | "You need CAMP tokens for gas. Visit the faucet to get some." |
| Wrong network | "Please switch to the Basecamp network in your wallet." |
| Timeout | "This is taking longer than expected. You can wait or try again." |

---

## Logging and Debugging

### What to Log

| Event | Log Level | Data to Include |
|-------|-----------|-----------------|
| API request | Debug | Method, path, (not body) |
| API response | Debug | Status, (not sensitive data) |
| API error | Error | Code, message, request ID |
| Wallet error | Error | Code, message |
| State transition | Debug | From state, to state |
| Job status | Debug | Job ID, state |

### Debug Mode

Consider implementing a debug mode that:
- Shows detailed error information
- Logs all API requests/responses
- Displays job status in console
- Shows wallet interactions

Enable via:
- URL parameter: `?debug=1`
- Local storage flag
- Environment variable
