# State Machine

This document describes the state machine for wallet-based deployment, covering both backend job states and frontend UI states.

---

## Backend Job States

The EVI service tracks deployment jobs through these states:

```
┌─────────┐     ┌─────────┐     ┌───────────────────┐     ┌───────────┐
│ queued  │ ──> │ running │ ──> │ pending_signature │ ──> │ completed │
└─────────┘     └─────────┘     └───────────────────┘     └───────────┘
                    │                     │
                    │                     │
                    ▼                     ▼
               ┌─────────┐           ┌─────────┐
               │ failed  │           │ expired │
               └─────────┘           └─────────┘
```

### State Descriptions

| State | Description | Duration | Frontend Action |
|-------|-------------|----------|-----------------|
| `queued` | Job is in queue waiting for processing | Seconds | Continue polling |
| `running` | AI is generating and compiling contract | 10-60 seconds | Continue polling |
| `pending_signature` | Contract ready, waiting for wallet signature | Until signed or expired | Fetch sign session |
| `completed` | Transaction confirmed, contract deployed | Terminal | Show success |
| `failed` | Job failed (generation, compilation, or deployment error) | Terminal | Show error |
| `expired` | Signing session expired without signature | Terminal | Show expired message |

### State Transitions

| From | To | Trigger |
|------|----|---------|
| `queued` | `running` | Worker picks up job |
| `running` | `pending_signature` | Contract compiled successfully |
| `running` | `failed` | Generation or compilation error |
| `pending_signature` | `completed` | Transaction confirmed on-chain |
| `pending_signature` | `expired` | Session timeout (no signature) |
| `pending_signature` | `failed` | Transaction reverted |

---

## Frontend UI States

The frontend should maintain its own state machine for UI rendering:

```
┌──────┐     ┌────────────┐     ┌─────────┐     ┌───────┐
│ idle │ ──> │ submitting │ ──> │ polling │ ──> │ ready │
└──────┘     └────────────┘     └─────────┘     └───────┘
                                     │              │
                                     │              ▼
                                     │         ┌─────────┐     ┌───────────┐     ┌───────────┐
                                     │         │ signing │ ──> │ submitted │ ──> │ confirmed │
                                     │         └─────────┘     └───────────┘     └───────────┘
                                     │              │                │
                                     ▼              ▼                ▼
                                ┌─────────┐   ┌─────────┐       ┌─────────┐
                                │  error  │   │  error  │       │  error  │
                                └─────────┘   └─────────┘       └─────────┘
```

### UI State Descriptions

| State | User Action | UI Display | Next State |
|-------|-------------|------------|------------|
| `idle` | Click deploy | Deploy button enabled | `submitting` |
| `submitting` | Wait | Loading spinner, "Initiating deployment..." | `polling` or `error` |
| `polling` | Wait | Progress indicator, "Generating contract..." | `ready` or `error` |
| `ready` | Click sign | Contract info, "Sign & Deploy" button | `signing` |
| `signing` | Approve in wallet | "Waiting for signature...", wallet popup | `submitted` or `error` |
| `submitted` | Wait | "Confirming transaction...", tx hash | `confirmed` or `error` |
| `confirmed` | View result | Success message, explorer link | `idle` (reset) |
| `error` | Retry or dismiss | Error message, retry button | `idle` or previous |

---

## State Data Requirements

### Per-State Data

| State | Required Data |
|-------|---------------|
| `idle` | None |
| `submitting` | None |
| `polling` | `jobId`, `pollCount` |
| `ready` | `jobId`, `session` (with `unsignedTx`, `chainId`, etc.) |
| `signing` | `jobId`, `session` |
| `submitted` | `jobId`, `session`, `txHash` |
| `confirmed` | `jobId`, `txHash`, `contractAddress` (from receipt) |
| `error` | `errorMessage`, `previousState` (for retry) |

### Session Object Structure

When in `ready` or `signing` state, the session object contains:

```
session: {
  sessionId: string
  jobId: string
  contractName: string
  network: string
  networkName: string
  estimatedGas: string
  chainId: number
  expiresAt: number
  status: string
  unsignedTx: {
    to: string | null
    data: string
    value: string
    gasLimit: string
    chainId: number
    type: number
    maxFeePerGas: string
    maxPriorityFeePerGas: string
  }
}
```

---

## Polling Strategy

### Recommended Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Interval | 3 seconds | Balance between responsiveness and API load |
| Max polls | 40 | 2 minutes total before timeout |
| Backoff | None | Contract generation time is unpredictable |

### Polling Logic

```
1. Start interval timer (3 seconds)
2. On each tick:
   a. Increment poll count
   b. Call GET /job/{jobId}/status
   c. Check response.data.state:
      - "queued" or "running": continue polling
      - "pending_signature": stop polling, extract sessionId, transition to ready
      - "failed": stop polling, extract error, transition to error
      - "completed": stop polling, transition to confirmed
3. If poll count > 40: stop polling, show timeout error
4. On component unmount: clear interval
```

### Handling Polling Failures

| Failure Type | Action |
|--------------|--------|
| Network error | Retry on next interval |
| 401 Unauthorized | Stop polling, redirect to login |
| 404 Not Found | Stop polling, show error |
| 429 Rate Limited | Increase interval, continue |
| 500+ Server Error | Retry on next interval |

---

## Transition Handlers

### idle → submitting

**Trigger**: User clicks deploy button

**Actions**:
1. Validate prompt is not empty
2. Validate wallet is connected
3. Set state to `submitting`
4. Call POST /wallet/deploy
5. On success: store jobId, transition to `polling`
6. On error: transition to `error`

### submitting → polling

**Trigger**: Deploy API returns successfully

**Actions**:
1. Store `jobId` from response
2. Set `pollCount` to 0
3. Start polling interval
4. Set state to `polling`

### polling → ready

**Trigger**: Job state becomes `pending_signature`

**Actions**:
1. Stop polling interval
2. Extract `sessionId` from `response.data.result.sessionId`
3. Call GET /wallet/sign/{sessionId}
4. Store session data
5. Check if wallet chain matches `session.chainId`
6. Set state to `ready`

### ready → signing

**Trigger**: User clicks "Sign & Deploy"

**Actions**:
1. If wrong chain: switch chain first
2. Build transaction from `session.unsignedTx`
3. Call wallet's sendTransaction
4. Set state to `signing`

### signing → submitted

**Trigger**: Wallet returns transaction hash

**Actions**:
1. Store `txHash`
2. Call POST /wallet/sign/{sessionId}/submit
3. Start waiting for transaction receipt
4. Set state to `submitted`

### submitted → confirmed

**Trigger**: Transaction receipt received

**Actions**:
1. Extract `contractAddress` from receipt (if contract creation)
2. Set state to `confirmed`
3. Display success with explorer link

### Any → error

**Trigger**: Any error occurs

**Actions**:
1. Store error message
2. Store previous state (for potential retry)
3. Set state to `error`
4. Display error to user

---

## Reset and Retry

### Full Reset

When user dismisses success or wants to deploy again:

1. Clear all state data
2. Set state to `idle`

### Retry from Error

Depending on where error occurred:

| Error Source | Retry Action |
|--------------|--------------|
| Deploy API | Retry from `submitting` |
| Polling timeout | Retry from `submitting` (new job) |
| Sign session fetch | Retry fetch, stay in `polling` |
| User rejected signature | Return to `ready`, allow re-sign |
| Transaction failed | Return to `ready`, allow re-sign |
| Submit API | Retry submit with same txHash |

---

## Timeout Handling

### Polling Timeout

If polling exceeds 2 minutes without reaching `pending_signature`:

1. Stop polling
2. Show message: "Contract generation is taking longer than expected"
3. Offer options:
   - Continue waiting (resume polling)
   - Cancel (reset to idle)

### Session Expiry

If `session.expiresAt` is reached before signing:

1. Show message: "Signing session expired"
2. Offer to restart deployment
3. Reset to idle

### Transaction Confirmation Timeout

If transaction receipt not received within 5 minutes:

1. Show message: "Transaction pending"
2. Provide explorer link to check status
3. Allow user to dismiss (transaction may still confirm)
