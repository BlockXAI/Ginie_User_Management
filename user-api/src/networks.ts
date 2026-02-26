/**
 * Supported blockchain networks configuration
 * Add new networks here to make them available for deployment
 */

export interface NetworkConfig {
  id: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  blockExplorer: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  testnet: boolean;
  enabled: boolean;
}

export const SUPPORTED_NETWORKS: Record<string, NetworkConfig> = {
  // Avalanche Fuji Testnet
  'avalanche-fuji': {
    id: 'avalanche-fuji',
    name: 'Avalanche Fuji Testnet',
    chainId: 43113,
    rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
    blockExplorer: 'https://testnet.snowtrace.io',
    nativeCurrency: { name: 'AVAX', symbol: 'AVAX', decimals: 18 },
    testnet: true,
    enabled: true,
  },
  // Basecamp (Camp Network)
  'basecamp': {
    id: 'basecamp',
    name: 'Basecamp',
    chainId: 123420001114,
    rpcUrl: 'https://rpc.basecamp.t.raas.gelato.cloud',
    blockExplorer: 'https://basecamp.cloud.blockscout.com',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    testnet: true,
    enabled: true,
  },
  // Basecamp Testnet (alias)
  'basecamp-testnet': {
    id: 'basecamp-testnet',
    name: 'Basecamp Testnet',
    chainId: 123420001114,
    rpcUrl: 'https://rpc.basecamp.t.raas.gelato.cloud',
    blockExplorer: 'https://basecamp.cloud.blockscout.com',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    testnet: true,
    enabled: true,
  },
  // Camp Network Testnet V2
  'camp-testnet-v2': {
    id: 'camp-testnet-v2',
    name: 'Camp Network Testnet V2',
    chainId: 325000,
    rpcUrl: 'https://rpc-campnetwork.xyz',
    blockExplorer: 'https://camp-network-testnet.blockscout.com',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    testnet: true,
    enabled: true,
  },
  // Sepolia (Ethereum Testnet)
  'sepolia': {
    id: 'sepolia',
    name: 'Sepolia Testnet',
    chainId: 11155111,
    rpcUrl: 'https://rpc.sepolia.org',
    blockExplorer: 'https://sepolia.etherscan.io',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    testnet: true,
    enabled: true,
  },
  // Polygon Mumbai (deprecated but kept for compatibility)
  'polygon-mumbai': {
    id: 'polygon-mumbai',
    name: 'Polygon Mumbai',
    chainId: 80001,
    rpcUrl: 'https://rpc-mumbai.maticvigil.com',
    blockExplorer: 'https://mumbai.polygonscan.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    testnet: true,
    enabled: false, // Mumbai is deprecated
  },
  // Polygon Amoy (new testnet)
  'polygon-amoy': {
    id: 'polygon-amoy',
    name: 'Polygon Amoy Testnet',
    chainId: 80002,
    rpcUrl: 'https://rpc-amoy.polygon.technology',
    blockExplorer: 'https://amoy.polygonscan.com',
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
    testnet: true,
    enabled: true,
  },
  // Base Sepolia
  'base-sepolia': {
    id: 'base-sepolia',
    name: 'Base Sepolia Testnet',
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    blockExplorer: 'https://sepolia.basescan.org',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    testnet: true,
    enabled: true,
  },
  // Arbitrum Sepolia
  'arbitrum-sepolia': {
    id: 'arbitrum-sepolia',
    name: 'Arbitrum Sepolia Testnet',
    chainId: 421614,
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    blockExplorer: 'https://sepolia.arbiscan.io',
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    testnet: true,
    enabled: true,
  },
};

/**
 * Get all enabled network IDs
 */
export function getEnabledNetworkIds(): string[] {
  return Object.values(SUPPORTED_NETWORKS)
    .filter(n => n.enabled)
    .map(n => n.id);
}

/**
 * Check if a network is supported and enabled
 */
export function isNetworkSupported(networkId: string): boolean {
  const network = SUPPORTED_NETWORKS[networkId];
  return !!network && network.enabled;
}

/**
 * Get network config by ID
 */
export function getNetworkConfig(networkId: string): NetworkConfig | undefined {
  return SUPPORTED_NETWORKS[networkId];
}

/**
 * Get network display name
 */
export function getNetworkDisplayName(networkId: string): string {
  return SUPPORTED_NETWORKS[networkId]?.name || networkId;
}

/**
 * Get all networks as array (for API responses)
 */
export function getAllNetworks(): NetworkConfig[] {
  return Object.values(SUPPORTED_NETWORKS);
}

/**
 * Get enabled networks as array
 */
export function getEnabledNetworks(): NetworkConfig[] {
  return Object.values(SUPPORTED_NETWORKS).filter(n => n.enabled);
}
