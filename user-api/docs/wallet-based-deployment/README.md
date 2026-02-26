# Wallet-Based Smart Contract Deployment

## Overview

This documentation covers how to integrate wallet-based smart contract deployment into any frontend application using the EVI Wrapper APIs. This feature allows users to deploy AI-generated smart contracts using their own wallet (MetaMask, etc.) instead of relying on platform-managed wallets.

## Documentation Structure

| Document | Description |
|----------|-------------|
| [01-architecture.md](./01-architecture.md) | System architecture and flow overview |
| [02-api-reference.md](./02-api-reference.md) | Complete API endpoint reference |
| [03-integration-guide.md](./03-integration-guide.md) | Step-by-step integration guide |
| [04-state-machine.md](./04-state-machine.md) | Job states and UI state management |
| [05-chain-configuration.md](./05-chain-configuration.md) | Blockchain network configuration |
| [06-error-handling.md](./06-error-handling.md) | Error handling and troubleshooting |
| [07-security.md](./07-security.md) | Security considerations and best practices |

## Quick Start

### Prerequisites

1. **Authentication**: User must be authenticated with valid session cookies
2. **Entitlement**: User must have `wallet_deployments` entitlement (Pro tier)
3. **Wallet**: User must have a Web3 wallet (MetaMask recommended)
4. **Network**: Wallet must be connected to the correct blockchain network

### The Flow in 30 Seconds

```
1. User submits prompt → POST /u/proxy/wallet/deploy
2. Backend generates contract → Returns jobId
3. Frontend polls job status → GET /u/proxy/job/{jobId}/status
4. Job reaches "pending_signature" → Contains sessionId
5. Frontend fetches unsigned tx → GET /u/proxy/wallet/sign/{sessionId}
6. User signs with wallet → Wallet prompts signature
7. Frontend submits signed tx → POST /u/proxy/wallet/sign/{sessionId}/submit
8. Transaction confirmed → Contract deployed!
```

## Key Concepts

### Job-Based Architecture

The deployment process is asynchronous. When you initiate a deployment, you receive a `jobId` that you poll until the contract is ready for signing.

### Session-Based Signing

Once the contract is compiled, a signing session is created with a `sessionId`. This session contains the unsigned transaction that the user's wallet will sign.

### Chain Flexibility

The backend determines which chain to deploy to based on the user's request. The frontend must ensure the wallet is connected to the correct chain before signing.

## Supported Chains

| Chain | Chain ID | Native Token | Status |
|-------|----------|--------------|--------|
| Basecamp | 123420001114 | CAMP | Primary |
| Camp Network Testnet V2 | 325000 | ETH | Supported |

## Authentication Requirements

All wallet deployment endpoints require:

1. **Valid session cookies** (`access_token`, `refresh_token`)
2. **CSRF token** for POST requests (`x-csrf-token` header matching `csrf` cookie)
3. **Pro entitlement** (`wallet_deployments` feature flag)

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| POST /wallet/deploy | 10 requests per 15 minutes per user |
| GET /wallet/sign/{sessionId} | 100 requests per 15 minutes per user |
| POST /wallet/sign/{sessionId}/submit | 20 requests per 15 minutes per user |

## Next Steps

1. Read [01-architecture.md](./01-architecture.md) to understand the system
2. Review [02-api-reference.md](./02-api-reference.md) for endpoint details
3. Follow [03-integration-guide.md](./03-integration-guide.md) to implement
