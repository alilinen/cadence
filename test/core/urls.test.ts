import { describe, expect, it } from 'vitest'
import { assetBaseUrl, normalizeBaseUrl } from '../../src/core/urls.js'

describe('deployment URL configuration', () => {
  it.each(['https://calendar.example', 'https://calendar.example/book', 'https://calendar.example/booking', 'http://localhost:8787/tools/calendar'])('normalizes %s', (base) => {
    expect(normalizeBaseUrl(base + '/')).toBe(base)
    expect(assetBaseUrl(base)).toBe(base)
  })
  it.each(['javascript:alert(1)', 'https://a.example/book?query=1', 'https://a.example/book#hash', 'https://user:pass@a.example/book', 'https://a.example/a%2fb', 'https://a.example/a//b', 'https://a.example/a\\b'])('rejects ambiguous URL %s', (base) => {
    expect(() => normalizeBaseUrl(base)).toThrow()
  })
  it('requires a secure CDN and allows local HTTP development on the same origin', () => {
    expect(() => assetBaseUrl('https://app.example', 'http://cdn.example')).toThrow()
    expect(assetBaseUrl('http://localhost:8787/book', 'http://localhost:8787/static')).toBe('http://localhost:8787/static')
  })
})
