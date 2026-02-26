/** @type {import('next').NextConfig} */
// Backend URL for the rewrite proxy
// In development: proxy to Railway backend (or local if BACKEND_URL is set)
// In production: no rewrite needed if NEXT_PUBLIC_API_BASE_URL is set in the client
const BACKEND_URL = process.env.BACKEND_URL || 'https://usermanagementapis-production.up.railway.app';

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/u', destination: '/api/proxy/u' },
      { source: '/u/:path*', destination: '/api/proxy/u/:path*' },
    ];
  },
};
module.exports = nextConfig;
