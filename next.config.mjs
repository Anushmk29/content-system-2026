/** @type {import('next').NextConfig} */
const nextConfig = {
  // The engine is a server-side package (uses `pg`). Keep it out of the client bundle.
  serverExternalPackages: ['pg', '@pratapai/content-pipeline', '@resvg/resvg-js', 'satori', 'satori-html'],
};

export default nextConfig;
