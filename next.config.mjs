/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['postgres', 'pdfkit'],
  agentRules: false,
  // Dev-only: allow the loopback/LAN hosts used to reach `next dev` so the
  // HMR websocket and afterInteractive scripts are not blocked as cross-origin.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '172.30.0.2'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' }
        ]
      }
    ];
  }
};

export default nextConfig;
