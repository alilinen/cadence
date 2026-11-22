/** Keep Cadence's root-based router behind Cadence's /book boundary. */
export const MOUNT = '/book'

export function publicPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return value
  if (value.startsWith(`${MOUNT}/brand/`) || value.split(/[?#]/, 1)[0] === `${MOUNT}/favicon.svg`) return value
  return `${MOUNT}${value}`
}

export function internalRequest(request: Request): Request | null {
  const url = new URL(request.url)
  if (url.pathname !== MOUNT && !url.pathname.startsWith(`${MOUNT}/`)) return null
  url.pathname = url.pathname.slice(MOUNT.length) || '/'
  const headers = new Headers(request.headers)
  const referer = headers.get('referer')
  if (referer) {
    try {
      const from = new URL(referer)
      if (from.origin === url.origin && from.pathname.startsWith(`${MOUNT}/`)) {
        from.pathname = from.pathname.slice(MOUNT.length)
        headers.set('referer', from.href)
      }
    } catch { /* An invalid optional Referer is not an authority signal. */ }
  }
  return new Request(url, new Request(request, { headers }))
}

export function mountedResponse(response: Response, request: Request, preview = false): Response {
  const headers = new Headers(response.headers)
  const location = headers.get('location')
  if (location?.startsWith('/') && !location.startsWith('//')) headers.set('location', publicPath(location))
  else if (location) {
    const target = new URL(location, request.url)
    if (target.origin === new URL(request.url).origin && !target.pathname.startsWith(`${MOUNT}/`)) {
      target.pathname = `${MOUNT}${target.pathname}`
      headers.set('location', target.href)
    }
  }
  const cookies = headers.getSetCookie()
  if (cookies.length) {
    headers.delete('set-cookie')
    for (const cookie of cookies) headers.append('set-cookie', cookie.replace(/(;\s*Path=)(\/[^;]*)/i, (_match, lead, path) => `${lead}${MOUNT}${path === '/' ? '' : path}`))
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
      for (const attr of ['href', 'src', 'action', 'poster', 'data-theme-light-src', 'data-theme-dark-src', 'data-theme-light-href', 'data-theme-dark-href']) {
        const value = element.getAttribute(attr)
        if (value) element.setAttribute(attr, publicPath(value))
      }
      if (preview && element.tagName === 'body') element.prepend('<div class="cadence-preview" role="status">Design preview · Sample availability. No calendar invitations are sent.</div>', { html: true })
    },
  }).transform(mounted)
}
