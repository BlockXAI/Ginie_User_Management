# Quick Reference

A single-page reference for wallet-based deployment integration.

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/u/proxy/wallet/deploy` | Initiate deployment |
| GET | `/u/proxy/job/{jobId}/status` | Poll job status |
| GET | `/u/proxy/wallet/sign/{sessionId}` | Get unsigned transaction |
| POST | `/u/proxy/wallet/sign/{sessionId}/submit` | Submit signed tx hash |

---

## Headers

### All Requests
```
Cookie: access_token=...; refresh_token=...; csrf=...
```

### POST Requests (Additional)
```
Content-Type: application/json
x-csrf-token: <csrf cookie value>
```

---

## Request/Response Quick Reference

### Deploy Request
```json
{
  "prompt": "Create an ERC20 token...",
  "network": "basecamp",
  "walletAddress": "0x..."
}
```

### Deploy Response
```json
{
  "ok": true,
  "data": {
    "jobId": "ai_wallet_deploy_...",
    "status": "queued"
  }
}
```

### Job Status Response (Ready)
```json
{
  "ok": true,
  "data": {
    "state": "pending_signature",
    "result": {
      "sessionId": "sess_...",
      "contractName": "MyToken"
    }
  }
}
```

### Sign Session Response
```json
{
  "sessionId": "sess_...",
  "chainId": 123420001114,
  "unsignedTx": {
    "to": null,
    "data": "0x...",
    "gasLimit": "2000000",
    "chainId": 123420001114
  }
}
```

### Submit Request
```json
{
  "txHash": "0x...",
  "walletAddress": "0x..."
}
```

---

## Job States

| State | Action |
|-------|--------|
| `queued` | Keep polling |
| `running` | Keep polling |
| `pending_signature` | Fetch sign session |
| `completed` | Show success |
| `failed` | Show error |

---

## Chain Configuration

### Basecamp (Primary)

| Property | Value |
|----------|-------|
| Chain ID | `123420001114` |
| Hex | `0x1cbc67c35a` |
| RPC | `https://rpc.basecamp.t.raas.gelato.cloud` |
| Explorer | `https://basecamp.cloud.blockscout.com` |
| Currency | CAMP |
| Faucet | `https://www.campnetwork.xyz/faucet_l1` |

---

## Flow Summary

```
1. POST /wallet/deploy → jobId
2. Poll GET /job/{jobId}/status until state = "pending_signature"
3. Extract sessionId from result.sessionId
4. GET /wallet/sign/{sessionId} → unsignedTx
5. Verify wallet on correct chain (switch if needed)
6. sendTransaction(unsignedTx) → txHash
7. POST /wallet/sign/{sessionId}/submit with txHash
8. Wait for transaction confirmation
9. Display success with explorer link
```

---

## Common Errors

| Error | Solution |
|-------|----------|
| 401 | Refresh token, re-authenticate |
| 403 | Check CSRF header, verify Pro status |
| 429 | Wait and retry |
| Chain mismatch | Switch chain before signing |
| User rejected | Allow re-signing |
| Insufficient funds | Get tokens from faucet |

---

## Polling Configuration

| Parameter | Recommended Value |
|-----------|-------------------|
| Interval | 3 seconds |
| Max Duration | 2 minutes |
| Max Polls | 40 |

---

## Transaction Building

From `session.unsignedTx`:

```
{
  to: unsignedTx.to,
  data: unsignedTx.data,
  value: unsignedTx.value,
  gas: unsignedTx.gasLimit,
  maxFeePerGas: unsignedTx.maxFeePerGas,
  maxPriorityFeePerGas: unsignedTx.maxPriorityFeePerGas,
  chainId: unsignedTx.chainId
}
```

---

## Explorer URLs

```
Transaction: https://basecamp.cloud.blockscout.com/tx/{txHash}
Address: https://basecamp.cloud.blockscout.com/address/{address}
```
