import { previewDashboard } from './preview-dashboard.js'
import { renderPreview } from './preview-page.js'
import { internalRequest, mountOptions, mountedResponse, staticResponse } from './mount.js'

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher; BASE_URL?: string; ASSET_BASE_URL?: string }): Promise<Response> {
    const paths = { ...mountOptions(env.BASE_URL ?? new URL(request.url).origin + '/book', env.ASSET_BASE_URL), preview: true }
    if (paths.mount && ['GET', 'HEAD'].includes(request.method) && new URL(request.url).pathname === '/') {
      return Response.redirect(new URL(paths.mount, request.url).href, 302)
    }
    const internal = internalRequest(request, paths)
    if (!internal) return new Response('Not found', { status: 404 })
    const asset = await staticResponse(internal, env.ASSETS)
    if (asset) return asset
    if (new URL(internal.url).pathname.startsWith('/dashboard')) {
      if (request.method !== 'GET') return new Response('Design preview: changes are not saved.', { status: 405 })
      return mountedResponse(previewDashboard(new URL(internal.url), paths.mount), request, paths)
    }
    return mountedResponse(await renderPreview(internal, Date.now(), paths.mount), request, paths)
  },
}
