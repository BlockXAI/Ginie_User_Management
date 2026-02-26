# Architecture Overview

## System Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │   Wallet    │  │   Deploy    │  │   Polling   │  │   Signing   │    │
│  │  Provider   │  │   Trigger   │  │   Service   │  │    Modal    │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
└─────────┼────────────────┼────────────────┼────────────────┼────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         WRAPPER API (User Management)                    │
│                                                                          │
│  • Authentication & Authorization                                        │
│  • Rate Limiting                                                         │
│  • CSRF Protection                                                       │
│  • Entitlement Checking (Pro features)                                   │
│  • Request Proxying to EVI Service                                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         EVI WALLET SERVICE                               │
│                                                                          │
│  • AI Contract Generation                                                │
│  • Solidity Compilation                                                  │
│  • Transaction Building                                                  │
│  • Session Management                                                    │
│  • Deployment Tracking                                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           BLOCKCHAIN                                     │
│                                                                          │
│  • Basecamp (Chain ID: 123420001114)                                    │
│  • Camp Network Testnet V2 (Chain ID: 325000)                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Request Flow

### Phase 1: Initiate Deployment

```
Frontend                    Wrapper API                 EVI Service
   │                            │                            │
   │  POST /wallet/deploy       │                            │
   │  {prompt, network, ...}    │                            │
   │ ──────────────────────────>│                            │
   │                            │  POST /api/wallet/deploy   │
   │                            │ ──────────────────────────>│
   │                            │                            │
   │                            │  {jobId, status}           │
   │                            │ <──────────────────────────│
   │  {jobId, status}           │                            │
   │ <──────────────────────────│                            │
```

### Phase 2: Poll for Completion

```
Frontend                    Wrapper API                 EVI Service
   │                            │                            │
   │  GET /job/{jobId}/status   │                            │
   │ ──────────────────────────>│                            │
   │                            │  GET /api/job/{jobId}      │
   │                            │ ──────────────────────────>│
   │                            │                            │
   │                            │  {state, result}           │
   │                            │ <──────────────────────────│
   │  {state, result}           │                            │
   │ <──────────────────────────│                            │
   │                            │                            │
   │  (repeat until state =     │                            │
   │   "pending_signature")     │                            │
```

### Phase 3: Fetch Signing Session

```
Frontend                    Wrapper API                 EVI Service
   │                            │                            │
   │  GET /wallet/sign/{sid}    │                            │
   │ ──────────────────────────>│                            │
   │                            │  GET /api/wallet/sign/{sid}│
   │                            │ ──────────────────────────>│
   │                            │                            │
   │                            │  {unsignedTx, chainId, ...}│
   │                            │ <──────────────────────────│
   │  {unsignedTx, chainId, ...}│                            │
   │ <──────────────────────────│                            │
```

### Phase 4: Sign and Submit

```
Frontend                    User Wallet                 Blockchain
   │                            │                            │
   │  sendTransaction(tx)       │                            │
   │ ──────────────────────────>│                            │
   │                            │  (User approves)           │
   │                            │ ──────────────────────────>│
   │                            │                            │
   │                            │  txHash                    │
   │ <──────────────────────────│ <──────────────────────────│
   │                            │                            │

Frontend                    Wrapper API                 EVI Service
   │                            │                            │
   │  POST /wallet/sign/{sid}/  │                            │
   │       submit               │                            │
   │  {txHash, walletAddress}   │                            │
   │ ──────────────────────────>│                            │
   │                            │  POST /api/.../submit      │
   │                            │ ──────────────────────────>│
   │                            │                            │
   │                            │  {success, message}        │
   │                            │ <──────────────────────────│
   │  {success, message}        │                            │
   │ <──────────────────────────│                            │
```

## Data Flow

### Deploy Request Payload

```
{
  prompt: string,           // User's contract description
  network: string,          // Target network (e.g., "basecamp")
  walletAddress: string,    // User's wallet address
  constructorArgs?: any[]   // Optional constructor arguments
}
```

### Job Status Response

```
{
  ok: true,
  data: {
    jobId: string,
    state: "queued" | "running" | "pending_signature" | "completed" | "failed",
    result: {
      sessionId?: string,      // Present when state = "pending_signature"
      contractName?: string,
      network?: string,
      estimatedGas?: string,
      error?: string           // Present when state = "failed"
    }
  }
}
```

### Sign Session Response

```
{
  sessionId: string,
  jobId: string,
  contractName: string,
  network: string,
  networkName: string,
  estimatedGas: string,
  chainId: number,
  expiresAt: number,         // Unix timestamp
  status: string,
  unsignedTx: {
    to?: string,             // null for contract creation
    data: string,            // Contract bytecode + constructor args
    value?: string,          // Wei value (usually "0")
    gasLimit?: string,
    chainId: number,
    type?: number,           // EIP-1559 type
    maxFeePerGas?: string,
    maxPriorityFeePerGas?: string
  }
}
```

## Security Layers

### Layer 1: Authentication
- HTTP-only cookies for session tokens
- Automatic token refresh

### Layer 2: Authorization
- Entitlement checking (`wallet_deployments`)
- Pro tier requirement

### Layer 3: CSRF Protection
- Double-submit cookie pattern
- Required for all POST requests

### Layer 4: Rate Limiting
- Per-user limits on all endpoints
- Prevents abuse and DoS

### Layer 5: Session Expiry
- Signing sessions expire after a set time
- Prevents stale transaction submission

## Frontend Responsibilities

1. **Wallet Management**: Connect, disconnect, chain switching
2. **State Management**: Track deployment progress through states
3. **Polling**: Efficiently poll job status with backoff
4. **Chain Validation**: Ensure wallet is on correct chain before signing
5. **Error Handling**: Display meaningful errors to users
6. **Transaction Tracking**: Monitor transaction confirmation

## Backend Responsibilities

1. **Contract Generation**: AI-powered Solidity generation
2. **Compilation**: Compile and validate contracts
3. **Transaction Building**: Create unsigned transactions
4. **Session Management**: Track signing sessions
5. **Deployment Recording**: Record successful deployments
