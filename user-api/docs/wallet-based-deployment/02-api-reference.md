# API Reference

## Base URL

All endpoints are prefixed with your wrapper API base URL:

```
Production: https://your-api-domain.com
Development: http://localhost:8080
```

All wallet deployment endpoints use the `/u/proxy/wallet/` prefix.

---

## Authentication

All endpoints require authentication via HTTP-only cookies:

| Cookie | Description |
|--------|-------------|
| `access_token` | JWT access token (short-lived) |
| `refresh_token` | JWT refresh token (long-lived) |
| `csrf` | CSRF token for POST requests |

### CSRF Protection

For all POST requests, include the CSRF token as a header:

```
x-csrf-token: <value from csrf cookie>
```

---

## Endpoints

### 1. Initiate Wallet Deployment

**POST** `/u/proxy/wallet/deploy`

Initiates a new wallet-based contract deployment job.

#### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `x-csrf-token` | Yes | CSRF token from cookie |

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `prompt` | string | Yes | Natural language description of the contract |
| `network` | string | Yes | Target network identifier (e.g., `"basecamp"`) |
| `walletAddress` | string | Yes | User's wallet address (0x...) |
| `constructorArgs` | array | No | Arguments for contract constructor |

#### Example Request

```json
{
  "prompt": "Create an ERC20 token called MyToken with symbol MTK and 1 million initial supply",
  "network": "basecamp",
  "walletAddress": "0x1234567890abcdef1234567890abcdef12345678"
}
```

#### Response

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Success indicator |
| `data.jobId` | string | Unique job identifier |
| `data.status` | string | Initial job status |
| `data.message` | string | Human-readable message |
| `data.checkStatusUrl` | string | URL to poll for status |

#### Example Response

```json
{
  "ok": true,
  "data": {
    "jobId": "ai_wallet_deploy_abc123-def456-789",
    "status": "queued",
    "message": "Wallet deployment job created",
    "checkStatusUrl": "/api/wallet/job/ai_wallet_deploy_abc123-def456-789/status"
  }
}
```

#### Error Responses

| Status | Code | Description |
|--------|------|-------------|
| 400 | `bad_request` | Invalid request body |
| 401 | `unauthorized` | Not authenticated |
| 403 | `forbidden` | Missing entitlement or CSRF |
| 429 | `rate_limited` | Too many requests |
| 502 | `upstream_error` | EVI service error |

---

### 2. Get Job Status

**GET** `/u/proxy/job/{jobId}/status`

Polls the status of a deployment job.

#### Path Parameters

| Parameter | Description |
|-----------|-------------|
| `jobId` | The job ID returned from deploy endpoint |

#### Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `includeMagical` | No | Set to `1` to include additional metadata |

#### Response

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Success indicator |
| `data.jobId` | string | Job identifier |
| `data.state` | string | Current job state |
| `data.result` | object | Job result data (when available) |

#### Job States

| State | Description | Next Action |
|-------|-------------|-------------|
| `queued` | Job is waiting to be processed | Continue polling |
| `running` | Contract is being generated/compiled | Continue polling |
| `pending_signature` | Ready for wallet signature | Fetch sign session |
| `completed` | Deployment successful | Show success |
| `failed` | Deployment failed | Show error |

#### Example Response (Running)

```json
{
  "ok": true,
  "data": {
    "jobId": "ai_wallet_deploy_abc123",
    "state": "running",
    "result": null
  }
}
```

#### Example Response (Pending Signature)

```json
{
  "ok": true,
  "data": {
    "jobId": "ai_wallet_deploy_abc123",
    "state": "pending_signature",
    "result": {
      "sessionId": "sess_xyz789",
      "contractName": "MyToken",
      "network": "basecamp",
      "estimatedGas": "0.00075"
    }
  }
}
```

#### Example Response (Failed)

```json
{
  "ok": true,
  "data": {
    "jobId": "ai_wallet_deploy_abc123",
    "state": "failed",
    "result": {
      "error": "Compilation failed: incorrect number of arguments to constructor"
    }
  }
}
```

---

### 3. Get Signing Session

**GET** `/u/proxy/wallet/sign/{sessionId}`

Retrieves the unsigned transaction for wallet signing.

#### Path Parameters

| Parameter | Description |
|-----------|-------------|
| `sessionId` | Session ID from job status result |

#### Response

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Session identifier |
| `jobId` | string | Associated job ID |
| `contractName` | string | Name of the contract |
| `network` | string | Network identifier |
| `networkName` | string | Human-readable network name |
| `estimatedGas` | string | Estimated gas in native token |
| `chainId` | number | Blockchain chain ID |
| `expiresAt` | number | Session expiry (Unix timestamp) |
| `status` | string | Session status |
| `unsignedTx` | object | Transaction to sign |

#### Unsigned Transaction Object

| Field | Type | Description |
|-------|------|-------------|
| `to` | string \| null | Recipient (null for contract creation) |
| `data` | string | Transaction data (bytecode) |
| `value` | string | Wei value to send |
| `gasLimit` | string | Gas limit |
| `chainId` | number | Chain ID |
| `type` | number | Transaction type (2 for EIP-1559) |
| `maxFeePerGas` | string | Max fee per gas (wei) |
| `maxPriorityFeePerGas` | string | Max priority fee (wei) |

#### Example Response

```json
{
  "sessionId": "sess_xyz789",
  "jobId": "ai_wallet_deploy_abc123",
  "contractName": "MyToken",
  "network": "basecamp",
  "networkName": "Basecamp",
  "estimatedGas": "0.00075317413557132",
  "chainId": 123420001114,
  "expiresAt": 1735520400,
  "status": "pending",
  "unsignedTx": {
    "to": null,
    "data": "0x608060405234801561001057600080fd5b50...",
    "value": "0",
    "gasLimit": "2000000",
    "chainId": 123420001114,
    "type": 2,
    "maxFeePerGas": "1500000000",
    "maxPriorityFeePerGas": "1000000000"
  }
}
```

---

### 4. Submit Signed Transaction

**POST** `/u/proxy/wallet/sign/{sessionId}/submit`

Submits the transaction hash after the user signs with their wallet.

#### Path Parameters

| Parameter | Description |
|-----------|-------------|
| `sessionId` | Session ID from signing session |

#### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | Yes | `application/json` |
| `x-csrf-token` | Yes | CSRF token from cookie |

#### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `txHash` | string | Yes | Transaction hash from wallet |
| `walletAddress` | string | Yes | Signer's wallet address |

#### Example Request

```json
{
  "txHash": "0xabc123def456...",
  "walletAddress": "0x1234567890abcdef1234567890abcdef12345678"
}
```

#### Response

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Submission success |
| `jobId` | string | Associated job ID |
| `txHash` | string | Confirmed transaction hash |
| `message` | string | Status message |

#### Example Response

```json
{
  "success": true,
  "jobId": "ai_wallet_deploy_abc123",
  "txHash": "0xabc123def456...",
  "message": "Transaction submitted successfully"
}
```

---

## Error Response Format

All error responses follow this format:

```json
{
  "ok": false,
  "error": {
    "code": "error_code",
    "detail": "Human-readable error message"
  }
}
```

### Common Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `unauthorized` | 401 | Missing or invalid authentication |
| `forbidden` | 403 | Missing entitlement or CSRF token |
| `bad_request` | 400 | Invalid request parameters |
| `not_found` | 404 | Resource not found |
| `rate_limited` | 429 | Rate limit exceeded |
| `upstream_error` | 502 | EVI service error |
| `internal_error` | 500 | Server error |

---

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /wallet/deploy | 10 | 15 minutes |
| GET /job/{id}/status | 100 | 15 minutes |
| GET /wallet/sign/{id} | 100 | 15 minutes |
| POST /wallet/sign/{id}/submit | 20 | 15 minutes |

When rate limited, the response includes:

```json
{
  "ok": false,
  "error": {
    "code": "rate_limited",
    "detail": "Rate limit exceeded. Try again later."
  }
}
```
