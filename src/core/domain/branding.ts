import type { SettingsRepository } from '../../ports.js'
import { COMPANY_LOGO_KEY, COMPANY_LOGO_SHAPE, companyLogoFrom, fitKeyFor, type CompanyLogo } from './media.js'

export const FAVICON_KEY = 'favicon_key'
export const DARK_LOGO_KEY = 'company_logo_dark_key'
export const DARK_FAVICON_KEY = 'favicon_dark_key'
export const BRAND_HOME_KEY = 'home_website'

export const BRANDING_KEYS = [COMPANY_LOGO_KEY, COMPANY_LOGO_SHAPE, FAVICON_KEY, DARK_LOGO_KEY, DARK_FAVICON_KEY, BRAND_HOME_KEY] as const

export async function readBranding(settings: SettingsRepository) {
  return parseBranding(await settings.getMany(BRANDING_KEYS))
}

export function parseBranding(values: Record<string, string | undefined>) {
  return {
    logo: companyLogoFrom(values[COMPANY_LOGO_KEY], values[COMPANY_LOGO_SHAPE]),
    favicon: values[FAVICON_KEY] || null,
    darkLogo: companyLogoFrom(values[DARK_LOGO_KEY], values[COMPANY_LOGO_SHAPE]),
    darkFavicon: values[DARK_FAVICON_KEY] || null,
    website: linkedImageUrl(values[BRAND_HOME_KEY] ?? ''),
  }
}

export type InstanceBranding = ReturnType<typeof parseBranding>

/** Keep remote images on their original host. Cadence never downloads them. */
export function linkedImageUrl(value: string): string | null {
  if (!/^https:\/\//i.test(value) || value.length > 2048 || /[\s\\]/.test(value)) return null
  try {
    const url = new URL(value)
    return url.username || url.password ? null : url.href
  } catch {
    return null
  }
}

export function imageSource(key: string, shape?: CompanyLogo['shape'] | null): string {
  return linkedImageUrl(key) ?? '/avatars/' + encodeURIComponent(shape === 'natural' ? fitKeyFor(key) : key)
}

/** Email clients and social crawlers can use the metadata-free PNG rendition. */
export function logoPngPath(logo: CompanyLogo, baseUrl = ''): string {
  const linked = linkedImageUrl(logo.key)
  if (linked) return linked
  const key = logo.shape === 'natural' ? fitKeyFor(logo.key) : logo.key
  return baseUrl.replace(/\/$/, '') + '/avatars/' + encodeURIComponent(key.replace(/\.webp$/, '.png'))
}

export async function emailBranding(settings: SettingsRepository, baseUrl: string, assetBaseUrl?: string) {
  // A cosmetic lookup must never prevent a sign-in or booking email.
  const branding = await readBranding(settings).catch(() => null)
  return { baseUrl, assetBaseUrl, logoUrl: branding?.logo ? logoPngPath(branding.logo, baseUrl) : undefined }
}
