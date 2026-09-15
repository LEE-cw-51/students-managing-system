/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['postgres'],
  agentRules: false,
  // Dev-only: allow the loopback/LAN hosts used to reach `next dev` so the
  // HMR websocket and afterInteractive scripts are not blocked as cross-origin.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '172.30.0.2']
};

export default nextConfig;
