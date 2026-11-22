import { previewDashboard } from './preview-dashboard.js'
import { renderPreview } from './preview-page.js'
import { internalRequest, mountedResponse, MOUNT } from './mount.js'

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    if (['GET', 'HEAD'].includes(request.method) && new URL(request.url).pathname === '/') {
      return Response.redirect(new URL(MOUNT, request.url).href, 302)
    }
    const internal = internalRequest(request)
    if (!internal) return new Response('Not found', { status: 404 })
    if (request.method === 'GET' || request.method === 'HEAD') {
      const asset = await env.ASSETS.fetch(request)
      if (asset.status !== 404) return asset
    }
    if (new URL(internal.url).pathname.startsWith('/dashboard')) {
      if (request.method !== 'GET') return new Response('Design preview: changes are not saved.', { status: 405 })
      return mountedResponse(previewDashboard(new URL(internal.url)), request, true)
    }
    return mountedResponse(await renderPreview(internal), request, true)
  },
}
