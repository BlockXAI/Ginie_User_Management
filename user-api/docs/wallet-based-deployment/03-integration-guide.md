# Integration Guide

This guide walks you through integrating wallet-based smart contract deployment into your frontend application.

## Prerequisites

Before starting, ensure you have:

1. **Authentication system** integrated with the wrapper API
2. **Web3 wallet library** (Wagmi, ethers.js, web3.js, or similar)
3. **User with Pro entitlement** (wallet_deployments feature)

---

## Step 1: Set Up Wallet Connection

### Required Capabilities

Your wallet integration must support:

- Connecting to injected wallets (MetaMask, etc.)
- Switching chains programmatically
- Sending transactions
- Waiting for transaction receipts

### Chain Configuration

Configure your wallet provider with the target chain:

| Property | Basecamp Value |
|----------|----------------|
| Chain ID | `123420001114` |
| Chain Name | `Basecamp` |
| RPC URL | `https://rpc.basecamp.t.raas.gelato.cloud` |
| Native Currency | `CAMP` (18 decimals) |
| Block Explorer | `https://basecamp.cloud.blockscout.com` |

### Connection Flow

1. User clicks "Connect Wallet"
2. Wallet prompts for connection approval
3. Store connected address in state
4. Check if wallet is on correct chain
5. If wrong chain, prompt to switch

---

## Step 2: Implement the Deployment Flow

### 2.1 Create the API Client

Set up functions to call the wrapper API endpoints:

#### Deploy Function

```
POST /u/proxy/wallet/deploy
Headers:
  - Content-Type: application/json
  - x-csrf-token: <csrf cookie value>
  - Cookie: access_token, refresh_token, csrf

Body:
  - prompt: string (user's contract description)
  - network: string (e.g., "basecamp")
  - walletAddress: string (connected wallet address)
```

#### Job Status Function

```
GET /u/proxy/job/{jobId}/status?includeMagical=1
Headers:
  - Cookie: access_token, refresh_token
```

#### Sign Session Function

```
GET /u/proxy/wallet/sign/{sessionId}
Headers:
  - Cookie: access_token, refresh_token
```

#### Submit Transaction Function

```
POST /u/proxy/wallet/sign/{sessionId}/submit
Headers:
  - Content-Type: application/json
  - x-csrf-token: <csrf cookie value>
  - Cookie: access_token, refresh_token, csrf

Body:
  - txHash: string (transaction hash from wallet)
  - walletAddress: string (signer's address)
```

---

### 2.2 Implement the State Machine

Your UI should track these states:

| State | Description | UI Display |
|-------|-------------|------------|
| `idle` | No deployment in progress | Show deploy button |
| `submitting` | Sending deploy request | Show loading spinner |
| `polling` | Waiting for contract generation | Show progress indicator |
| `ready` | Contract ready for signing | Show sign button |
| `signing` | Waiting for wallet signature | Show wallet prompt message |
| `submitted` | Transaction sent, awaiting confirmation | Show pending status |
| `confirmed` | Transaction confirmed | Show success with explorer link |
| `error` | Something went wrong | Show error message |

---

### 2.3 Initiate Deployment

When user clicks deploy:

1. **Validate inputs**
   - Prompt is not empty
   - Wallet is connected
   - Wallet is on correct chain

2. **Call deploy endpoint**
   - Send prompt, network, walletAddress
   - Store returned jobId

3. **Transition to polling state**

---

### 2.4 Poll for Job Completion

After receiving jobId:

1. **Start polling interval** (recommended: 3 seconds)

2. **On each poll:**
   - Call job status endpoint
   - Check `data.state` field

3. **Handle states:**

   | State | Action |
   |-------|--------|
   | `queued` | Continue polling |
   | `running` | Continue polling |
   | `pending_signature` | Extract `sessionId` from `data.result.sessionId`, stop polling, proceed to signing |
   | `failed` | Stop polling, show error from `data.result.error` |
   | `completed` | Stop polling, show success |

4. **Implement timeout** (recommended: 2 minutes max polling)

---

### 2.5 Fetch Signing Session

When job reaches `pending_signature`:

1. **Extract sessionId** from job status response:
   ```
   sessionId = response.data.result.sessionId
   ```

2. **Call sign session endpoint**
   ```
   GET /u/proxy/wallet/sign/{sessionId}
   ```

3. **Store session data:**
   - `unsignedTx` - the transaction to sign
   - `chainId` - required chain
   - `contractName` - for display
   - `estimatedGas` - for display

4. **Validate chain:**
   - Compare `session.chainId` with wallet's current chain
   - If different, prompt user to switch chains

---

### 2.6 Sign Transaction

When user clicks "Sign & Deploy":

1. **Ensure correct chain**
   - If wallet is on wrong chain, call switch chain first
   - Wait for chain switch to complete

2. **Build transaction from session data:**
   ```
   transaction = {
     to: unsignedTx.to,           // null for contract creation
     data: unsignedTx.data,       // contract bytecode
     value: unsignedTx.value,     // usually "0"
     gas: unsignedTx.gasLimit,
     maxFeePerGas: unsignedTx.maxFeePerGas,
     maxPriorityFeePerGas: unsignedTx.maxPriorityFeePerGas,
     chainId: unsignedTx.chainId
   }
   ```

3. **Send transaction via wallet**
   - This triggers the wallet popup
   - User reviews and approves

4. **Capture transaction hash**
   - Store the returned txHash

---

### 2.7 Submit Transaction Hash

After wallet returns txHash:

1. **Call submit endpoint:**
   ```
   POST /u/proxy/wallet/sign/{sessionId}/submit
   Body: { txHash, walletAddress }
   ```

2. **This notifies backend** that transaction was submitted

3. **Transition to submitted state**

---

### 2.8 Wait for Confirmation

After submitting:

1. **Use wallet library to wait for receipt**
   - Most libraries have `waitForTransactionReceipt` or similar

2. **On confirmation:**
   - Transition to confirmed state
   - Display success message
   - Show link to block explorer

3. **On failure:**
   - Transition to error state
   - Display error message

---

## Step 3: Handle Chain Switching

### When to Switch

Switch chain when:
- `session.chainId !== wallet.chainId`
- User is on wrong network when trying to sign

### Switch Chain Flow

1. **Call wallet's switch chain method**
   - Pass target chainId

2. **If chain not in wallet:**
   - Call add chain method with full chain config
   - RPC URL, chain name, native currency, explorer

3. **Wait for switch to complete**

4. **Verify new chain matches required chain**

### Chain Config for Adding

```
{
  chainId: "0x1cbc67c35a",              // 123420001114 in hex
  chainName: "Basecamp",
  nativeCurrency: {
    name: "Camp",
    symbol: "CAMP",
    decimals: 18
  },
  rpcUrls: ["https://rpc.basecamp.t.raas.gelato.cloud"],
  blockExplorerUrls: ["https://basecamp.cloud.blockscout.com"]
}
```

---

## Step 4: Display Contract Information

### During Polling

Show:
- "Generating and compiling contract..."
- Elapsed time or poll count
- Cancel button (optional)

### Ready to Sign

Show:
- Contract name
- Target network
- Estimated gas cost
- "Sign & Deploy" button
- "Switch Network" button (if wrong chain)

### After Signing

Show:
- "Waiting for confirmation..."
- Transaction hash (truncated)
- Link to explorer

### On Success

Show:
- "Contract deployed successfully!"
- Contract address (from receipt)
- Full explorer link
- Option to view/interact with contract

---

## Step 5: Error Handling

### Common Errors and Handling

| Error | Cause | User Message |
|-------|-------|--------------|
| `unauthorized` | Session expired | "Please sign in again" |
| `forbidden` | No Pro access | "Upgrade to Pro to use wallet deployment" |
| `rate_limited` | Too many requests | "Please wait before trying again" |
| Contract generation failed | Invalid prompt | Show specific error from backend |
| User rejected | User cancelled in wallet | "Transaction cancelled" |
| Insufficient funds | Not enough gas | "Insufficient CAMP for gas" |
| Wrong chain | Chain mismatch | "Please switch to Basecamp network" |

### Retry Logic

- **Polling failures**: Retry with exponential backoff
- **Network errors**: Show retry button
- **User rejection**: Allow re-signing without restarting

---

## Complete Flow Checklist

- [ ] User is authenticated
- [ ] User has Pro entitlement
- [ ] Wallet is connected
- [ ] Wallet address is captured
- [ ] Deploy request sent with CSRF token
- [ ] Job ID stored
- [ ] Polling started with 3s interval
- [ ] Session ID extracted when state = pending_signature
- [ ] Sign session fetched
- [ ] Chain validated/switched
- [ ] Transaction sent to wallet
- [ ] User approved transaction
- [ ] Transaction hash captured
- [ ] Submit endpoint called
- [ ] Transaction receipt awaited
- [ ] Success displayed with explorer link
