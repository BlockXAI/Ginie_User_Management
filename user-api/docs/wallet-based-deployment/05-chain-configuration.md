# Chain Configuration

This document covers blockchain network configuration for wallet-based deployment.

---

## Supported Chains

### Primary: Basecamp

| Property | Value |
|----------|-------|
| Chain ID | `123420001114` |
| Chain ID (Hex) | `0x1cbc67c35a` |
| Network Name | Basecamp |
| Native Currency | CAMP |
| Currency Decimals | 18 |
| RPC URL | `https://rpc.basecamp.t.raas.gelato.cloud` |
| Block Explorer | `https://basecamp.cloud.blockscout.com` |
| Is Testnet | Yes |

### Secondary: Camp Network Testnet V2

| Property | Value |
|----------|-------|
| Chain ID | `325000` |
| Chain ID (Hex) | `0x4f588` |
| Network Name | Camp Network Testnet V2 |
| Native Currency | ETH |
| Currency Decimals | 18 |
| RPC URL | `https://rpc.camp-network-testnet.gelato.digital` |
| Block Explorer | `https://camp-network-testnet.blockscout.com` |
| Is Testnet | Yes |

---

## Chain ID Conversion

When working with chain IDs, you'll encounter both decimal and hexadecimal formats:

| Chain | Decimal | Hexadecimal |
|-------|---------|-------------|
| Basecamp | `123420001114` | `0x1cbc67c35a` |
| Camp Network Testnet V2 | `325000` | `0x4f588` |

### Conversion Formula

```
Decimal to Hex: chainId.toString(16)
Hex to Decimal: parseInt(hexChainId, 16)
```

---

## Wallet Configuration

### Adding Chain to MetaMask (wallet_addEthereumChain)

When the user's wallet doesn't have the chain configured, use the `wallet_addEthereumChain` RPC method:

#### Basecamp Configuration

```
{
  chainId: "0x1cbc67c35a",
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

#### Camp Network Testnet V2 Configuration

```
{
  chainId: "0x4f588",
  chainName: "Camp Network Testnet V2",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18
  },
  rpcUrls: ["https://rpc.camp-network-testnet.gelato.digital"],
  blockExplorerUrls: ["https://camp-network-testnet.blockscout.com"]
}
```

---

## Chain Detection

### Getting Current Chain from Wallet

The wallet exposes the current chain ID. Common methods:

| Library | Method |
|---------|--------|
| Raw Provider | `window.ethereum.chainId` (hex string) |
| Wagmi | `useChainId()` hook (number) |
| ethers.js | `provider.getNetwork().chainId` (number) |
| web3.js | `web3.eth.getChainId()` (number) |

### Comparing Chain IDs

Always normalize to the same format before comparing:

```
// If wallet returns hex, convert to number
walletChainId = parseInt(window.ethereum.chainId, 16)

// Compare with required chain
isCorrectChain = walletChainId === requiredChainId
```

---

## Chain Switching

### When to Switch

Switch chains when:
1. User connects wallet on wrong chain
2. Sign session requires different chain than current
3. User manually requests chain switch

### Switch Chain Flow

1. **Attempt switch** using `wallet_switchEthereumChain`
2. **If chain not found** (error code 4902), add chain first
3. **Verify switch** by checking new chain ID

### Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| 4902 | Chain not added to wallet | Call `wallet_addEthereumChain` |
| 4001 | User rejected request | Show message, allow retry |
| -32002 | Request already pending | Wait for user response |

---

## RPC Configuration

### Transport Setup

When configuring your Web3 provider, set up transports for each chain:

| Chain | Transport URL |
|-------|---------------|
| Basecamp | `https://rpc.basecamp.t.raas.gelato.cloud` |
| Camp Network Testnet V2 | `https://rpc.camp-network-testnet.gelato.digital` |

### RPC Methods Used

The deployment flow uses these RPC methods:

| Method | Purpose |
|--------|---------|
| `eth_chainId` | Get current chain |
| `eth_accounts` | Get connected accounts |
| `eth_sendTransaction` | Send deployment transaction |
| `eth_getTransactionReceipt` | Check transaction status |
| `eth_blockNumber` | Poll for new blocks |
| `wallet_switchEthereumChain` | Switch to required chain |
| `wallet_addEthereumChain` | Add new chain to wallet |

---

## Determining Required Chain

### From Sign Session Response

The sign session response includes the required chain:

```
{
  "chainId": 123420001114,
  "unsignedTx": {
    "chainId": 123420001114,
    ...
  }
}
```

### Priority Order

1. Use `session.unsignedTx.chainId` (most specific)
2. Fall back to `session.chainId`
3. Fall back to default chain (Basecamp)

---

## Explorer URLs

### Transaction URLs

Format: `{explorerBaseUrl}/tx/{txHash}`

| Chain | Example |
|-------|---------|
| Basecamp | `https://basecamp.cloud.blockscout.com/tx/0xabc...` |
| Camp Network | `https://camp-network-testnet.blockscout.com/tx/0xabc...` |

### Address URLs

Format: `{explorerBaseUrl}/address/{address}`

| Chain | Example |
|-------|---------|
| Basecamp | `https://basecamp.cloud.blockscout.com/address/0x123...` |
| Camp Network | `https://camp-network-testnet.blockscout.com/address/0x123...` |

### Building Explorer URLs

```
getExplorerUrl(chainId, txHash) {
  if (chainId === 123420001114) {
    return `https://basecamp.cloud.blockscout.com/tx/${txHash}`
  }
  if (chainId === 325000) {
    return `https://camp-network-testnet.blockscout.com/tx/${txHash}`
  }
  return null
}
```

---

## Faucets

### Getting Testnet Tokens

| Chain | Faucet URL |
|-------|------------|
| Basecamp | `https://www.campnetwork.xyz/faucet_l1` |
| Camp Network Testnet V2 | Check Camp Network documentation |

### Faucet Limits

Faucets typically have daily limits. Users may need to:
- Wait 24 hours between requests
- Complete verification (Twitter, etc.)
- Use alternative faucets if available

---

## Network Validation

### Before Deployment

Validate network configuration:

1. **RPC is reachable**: Test with `eth_chainId` call
2. **Chain ID matches**: Verify RPC returns expected chain ID
3. **User has balance**: Check native token balance for gas

### Common Issues

| Issue | Symptom | Solution |
|-------|---------|----------|
| Wrong RPC URL | Connection timeout | Use correct RPC URL |
| SSL certificate error | `ERR_CERT_COMMON_NAME_INVALID` | Use official RPC URL |
| RPC rate limited | 429 errors | Reduce request frequency |
| Chain not synced | Old block numbers | Wait or use different RPC |

---

## Multi-Chain Considerations

### Dynamic Chain Selection

The backend may return different chains based on:
- User's network preference
- Contract requirements
- Network availability

### Frontend Handling

1. **Don't hardcode chain ID** - read from session response
2. **Support multiple chains** - configure all supported chains
3. **Dynamic switching** - switch to whatever chain backend requires
4. **Explorer mapping** - map chain ID to correct explorer URL
