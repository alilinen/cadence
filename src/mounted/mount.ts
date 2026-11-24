import { assetBaseUrl, isBundledAsset, normalizeBaseUrl } from '../core/urls.js'

export interface MountOptions { mount: string; assets?: string; preview?: boolean }

export function mountOptions(baseUrl: string, assets?: string): MountOptions {
  const normalized = normalizeBaseUrl(baseUrl)
  return { mount: new URL(normalized).pathname.replace(/\/$/, ''),
    ...(assets ? { assets: assetBaseUrl(normalized, assets) } : {}) }
}

export function publicPath(value: string, options: MountOptions): string {
  if (!value.startsWith('/') || value.startsWith('//')) return value
  return (options.assets && isBundledAsset(value) ? options.assets : options.mount) + value
}

export function internalRequest(request: Request, { mount }: MountOptions): Request | null {
  const url = new URL(request.url)
  if (mount && url.pathname !== mount && !url.pathname.startsWith(`${mount}/`)) return null
  url.pathname = url.pathname.slice(mount.length) || '/'
  const headers = new Headers(request.headers)
  const referer = headers.get('referer')
  if (referer) {
    try {
      const from = new URL(referer)
      if (from.origin === url.origin && (from.pathname === mount || from.pathname.startsWith(`${mount}/`))) {
        from.pathname = from.pathname.slice(mount.length) || '/'
        headers.set('referer', from.href)
      }
    } catch { /* An invalid optional Referer is not an authority signal. */ }
  }
  return new Request(url, new Request(request, { headers }))
}

export function mountedResponse(response: Response, request: Request, options: MountOptions): Response {
  const { mount, preview } = options
  const headers = new Headers(response.headers)
  const location = headers.get('location')
  if (location?.startsWith('/') && !location.startsWith('//')) headers.set('location', publicPath(location, options))
  else if (location) {
    const target = new URL(location, request.url)
    if (target.origin === new URL(request.url).origin && target.pathname !== mount && !target.pathname.startsWith(`${mount}/`)) {
      target.pathname = `${mount}${target.pathname}`
      headers.set('location', target.href)
    }
  }
  const cookies = headers.getSetCookie()
  if (cookies.length) {
    headers.delete('set-cookie')
    for (const cookie of cookies) headers.append('set-cookie', cookie.replace(/(;\s*Path=)(\/[^;]*)/i,
      (_match, lead, path) => `${lead}${mount}${path === '/' ? (mount ? '' : '/') : path}`))
  }
  headers.set('x-content-type-options', 'nosniff')
  if (preview) {
    headers.set('x-robots-tag', 'noindex, nofollow')
    headers.set('cache-control', 'no-store')
  }
  const mounted = new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  if (!headers.get('content-type')?.includes('text/html')) return mounted
  return new HTMLRewriter().on('*', {
    element(element) {
      for (const attr of ['href', 'src', 'action', 'formaction', 'poster', 'data-theme-light-src', 'data-theme-dark-src', 'data-theme-light-href', 'data-theme-dark-href']) {
        const value = element.getAttribute(attr)
        if (value) element.setAttribute(attr, publicPath(value, options))
      }
      if (preview && element.tagName === 'body') element.prepend('<div class="cadence-preview" role="status">Design preview · Sample availability. No calendar invitations are sent.</div>', { html: true })
    },
  }).transform(mounted)
}

/** Fetch only GET/HEAD assets, after stripping the mount. Never send forms to ASSETS. */
export async function staticResponse(request: Request, assets?: Fetcher): Promise<Response | null> {
  if (!assets || !['GET', 'HEAD'].includes(request.method)) return null
  const path = new URL(request.url).pathname
  if (!isBundledAsset(path)) return null
  const response = await assets.fetch(request)
  if (response.status === 404 || response.headers.get('content-type')?.includes('text/html')) {
    return new Response('Asset not found', { status: 404 })
  }
  return response
}
