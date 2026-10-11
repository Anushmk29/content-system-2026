/** @type {import('next').NextConfig} */
const nextConfig = {
  // The engine is a server-side package (uses `pg`). Keep it out of the client bundle.
  serverExternalPackages: ['pg', '@pratapai/content-pipeline'],
  // The engine is symlinked (file:), so Next bundles it anyway, and sharp with it; bundled sharp
  // can't find its native binary and the build fails. Keep sharp a runtime require.
  webpack: (config, { isServer }) => {
    if (isServer) config.externals.push('sharp');
    return config;
  },
  // No framing, no MIME sniffing, no plugins. Script/style sources are left open on purpose:
  // pages load Google Fonts CSS and show third-party post thumbnails.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
      ],
    }];
  },
};

export default nextConfig;
