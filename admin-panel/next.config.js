/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Uncomment below if deploying as a standalone Docker container
  // (required for Vercel-less deployments using pm2/Docker):
  // output: 'standalone',

  // The admin panel's API routes (app/api/**/route.js) act as server-side
  // proxies to Apps Script and the local bot. Since the browser only ever
  // calls /api/* on its own origin, there are no CORS issues — Next.js
  // handles the cross-origin calls server-side.
  //
  // If you ever need to proxy additional paths to the bot directly (e.g. for
  // a real-time WebSocket connection), add rewrites here:
  //
  // async rewrites() {
  //   return [
  //     {
  //       source: '/bot/:path*',
  //       destination: `${process.env.LOCAL_BOT_URL || 'http://localhost:3000'}/:path*`,
  //     },
  //   ];
  // },
};

module.exports = nextConfig;
