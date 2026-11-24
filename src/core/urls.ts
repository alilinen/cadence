/** Public deployment URLs. Keep this pure: ports and templates also use it. */
export function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('BASE_URL must be an HTTP(S) URL without credentials, query or fragment')
  }
  // Encoded slashes and backslashes cannot define a mount boundary.
  if (!/^\/(?:[A-Za-z0-9._~-]+\/?)*$/.test(url.pathname) || value.includes('\\')) {
    throw new Error('BASE_URL must use plain, URL-safe path segments')
  }
  return url.origin + url.pathname.replace(/\/+$/, '')
}

/** Optional CDN base mirrors the contents of assets/, not the app routes. */
export function assetBaseUrl(baseUrl: string, override?: string): string {
  if (!override) return normalizeBaseUrl(baseUrl)
  const value = normalizeBaseUrl(override)
  if (!value.startsWith('https://') && new URL(value).origin !== new URL(baseUrl).origin) {
    throw new Error('ASSET_BASE_URL must use HTTPS (or the same origin for local development)')
  }
  return value
}

export function isBundledAsset(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0]!
  return pathname.startsWith('/brand/') || pathname.startsWith('/fonts/') ||
    pathname === '/cadence-email.png' || pathname === '/og/default.png'
}
