/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // xlsx（SheetJS）はNode.js fs モジュールを使うため、
    // webpack でバンドルせずサーバー側でそのまま使う
    // Next.js 14 での正しい書き方
    serverComponentsExternalPackages: [
      'xlsx',
      'playwright-core',
      '@sparticuz/chromium',
    ],
  },
}

module.exports = nextConfig
