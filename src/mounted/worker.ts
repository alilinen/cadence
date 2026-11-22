import cadence, { type Env } from '../index.js'
import { internalRequest, mountedResponse, MOUNT } from './mount.js'
export { HostCalendar, RateLimiter } from '../index.js'

type CadenceEnv = Env & { ASSETS: Fetcher; BOOKING_HOME_PATH?: string }

export default {
  ...cadence,
  async fetch(request: Request, env: CadenceEnv, ctx: ExecutionContext): Promise<Response> {
    const internal = internalRequest(request)
    if (!internal) return new Response('Not found', { status: 404 })
    const path = new URL(internal.url).pathname
    if (path === '/' && env.BOOKING_HOME_PATH) {
      const target = new URL(request.url)
      target.pathname = `${MOUNT}${env.BOOKING_HOME_PATH}`
      return Response.redirect(target.href, 302)
    }
    const faviconAlias = path === '/favicon.svg' && !new URL(request.url).searchParams.has('v')
    if (!faviconAlias && (request.method === 'GET' || request.method === 'HEAD')) {
      const assetRequest = new URL(request.url).pathname.startsWith(`${MOUNT}/brand/`) || path === '/favicon.svg' ? request : internal
      const asset = await env.ASSETS.fetch(assetRequest)
      if (asset.status !== 404) return asset
    }
    return mountedResponse(await cadence.fetch(internal, env, ctx), request)
  },
}
