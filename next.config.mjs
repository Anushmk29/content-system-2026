/** @type {import('next').NextConfig} */
const nextConfig = {
  // A production build next to a running `next dev` must not share its output folder (dev rewrites the manifests).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The engine is a server-side package (uses `pg`). Keep it out of the client bundle.
  serverExternalPackages: ['pg', '@pratapai/content-pipeline'],
  // Middleware buffers request bodies and silently cuts them at 10 MB by default, which breaks the
  // 50 MB video upload. Match middleware.ts MAX_BODY_BYTES; anything larger is cut and fails to parse.
  experimental: { middlewareClientMaxBodySize: '60mb' },
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
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      ],
    }];
  },
};

export default nextConfig;
