import type { NextConfig } from 'next';

/*
 * Optional same-origin proxy. When the browser cannot reach the API or the RPC node directly
 * (a remote preview, or one public origin in a demo), set these server-side variables and
 * point NEXT_PUBLIC_API_URL at '' and NEXT_PUBLIC_RPC_URL at '/rpc'. Unset means no rewrites.
 */
const apiTarget = process.env.API_PROXY_TARGET;
const rpcTarget = process.env.RPC_PROXY_TARGET;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      ...(apiTarget
        ? [{ source: '/api/v1/:path*', destination: `${apiTarget}/api/v1/:path*` }]
        : []),
      ...(rpcTarget ? [{ source: '/rpc', destination: rpcTarget }] : []),
    ];
  },
};

export default nextConfig;
