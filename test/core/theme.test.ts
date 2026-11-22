import { URL } from 'node:url'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { shellHead } from '../../src/http/pages/booking.js'
import { embedScript } from '../../src/http/embed.js'
import { CLASSIC } from '../../src/core/domain/appearance.js'

const script = readFileSync(new URL('../../assets/book/brand/theme.js', import.meta.url), 'utf8')
function boot(mode: string, options: { saved?: string; query?: string; preview?: boolean } = {}) {
  const root = { dataset: { themeBehaviour: mode, theme: options.preview ? 'dark' : 'light' }, hasAttribute: () => !!options.preview }
  const listeners: Record<string, (e?: any) => void> = {}
  const parent = {}, stranger = {}
  const image = { attrs: { 'data-theme-light-src':'light.png', 'data-theme-dark-src':'dark.png', src:'' } as Record<string,string>, getAttribute(key: string) { return this.attrs[key] }, setAttribute(key: string,value: string) { this.attrs[key] = value } }
  const favicon = { attrs: { 'data-theme-light-href':'light.ico', 'data-theme-dark-href':'dark.ico', href:'' } as Record<string,string>, getAttribute(key: string) { return this.attrs[key] }, setAttribute(key: string,value: string) { this.attrs[key] = value } }
  const sun = {hidden:false,getAttribute:()=> 'light'}, moon = {hidden:false,getAttribute:()=> 'dark'}
  const toggle = { hidden: false, setAttribute() {}, addEventListener(key: string, cb: any) { listeners[key] = cb } }
  const window = { parent, addEventListener: (key: string, cb: any) => { listeners[key] = cb } }
  runInNewContext(script, { document: { documentElement: root, addEventListener: (key: string, cb: any) => { listeners[key] = cb }, querySelectorAll: (q: string) => q === '[data-theme-light-src]' ? [image] : q === '[data-theme-light-href]' ? [favicon] : [sun,moon], querySelector: (q: string) => q === '[data-theme-toggle]' ? toggle : null }, window, URL,
    location: { href: 'https://calendar.example/' + (options.query ?? '') }, localStorage: { getItem: () => options.saved, setItem() {} }, matchMedia: () => ({ matches: true }), MutationObserver: class { observe() {} } })
  listeners.DOMContentLoaded!()
  return { root, toggle, image, favicon, sun, moon, click: () => listeners.click?.(), message: (theme: unknown, source = parent) => listeners.message?.({ source, data: { t: 'cadence:theme:1', theme } }), stranger }
}

describe('booking theme policy', () => {
  it.each(['light', 'dark'])('locks %s despite saved preference, query or parent messages', mode => {
    const x = boot(mode, { saved: mode === 'light' ? 'dark' : 'light', query: '?theme=dark' })
    x.message(mode === 'light' ? 'dark' : 'light')
    expect(x.root.dataset.theme).toBe(mode)
    expect(x.toggle.hidden).toBe(true)
  })
  it('follows only the embedding parent and accepts only explicit themes', () => {
    const x = boot('website', { saved: 'dark' })
    expect(x.root.dataset.theme).toBe('light')
    x.message('dark', x.stranger)
    expect(x.root.dataset.theme).toBe('light')
    x.message('dark')
    expect(x.root.dataset.theme).toBe('dark')
    x.message('invalid')
    expect(x.root.dataset.theme).toBe('dark')
    x.message('light')
    expect(x.root.dataset.theme).toBe('light')
    expect(x.toggle.hidden).toBe(true)
  })
  it('initialises website embeds from the supplied theme', () => {
    expect(boot('website', { query: '?theme=dark' }).root.dataset.theme).toBe('dark')
  })
  it('retains visitor control in independent mode', () => {
    const x = boot('independent', { saved: 'dark' })
    expect(x.root.dataset.theme).toBe('dark')
    expect(x.toggle.hidden).toBe(false)
  })
  it('switches logos, favicons and the next-action icon with the theme', () => {
    const x = boot('independent', {saved:'light'})
    expect(x.image.attrs.src).toBe('light.png')
    expect(x.favicon.attrs.href).toBe('light.ico')
    expect(x.moon.hidden).toBe(false)
    expect(x.sun.hidden).toBe(true)
    x.click()
    expect(x.image.attrs.src).toBe('dark.png')
    expect(x.favicon.attrs.href).toBe('dark.ico')
    expect(x.moon.hidden).toBe(true)
    expect(x.sun.hidden).toBe(false)
    x.click()
    expect(x.image.attrs.src).toBe('light.png')
    expect(x.favicon.attrs.href).toBe('light.ico')
  })
  it('does not overwrite the editor preview with a stored preference', () => {
    expect(boot('light', { preview: true, saved: 'light' }).root.dataset.theme).toBe('dark')
  })
  it('renders fixed light before scripts and leaves the dashboard independent', () => {
    expect(shellHead({ title:'Book', brandName:'Example', appearance:CLASSIC })).toContain('data-theme-behaviour="light" data-theme="light"')
    expect(shellHead({ title:'Dashboard', brandName:'Example', surface:'dashboard' })).toContain('data-theme-behaviour="independent"')
  })
})


it('sends the website theme on iframe load and when root attributes change', () => {
  const root = { dataset: { theme: 'dark' }, classList: { contains: () => false } }
  let changed: () => void = () => {}
  const messages: any[] = []
  const frame: any = { style: {}, setAttribute() {}, addEventListener(_key: string, cb: () => void) { changed = cb }, contentWindow: { postMessage: (...args: any[]) => messages.push(args) } }
  let observe: () => void = () => {}
  runInNewContext(embedScript('https://calendar.example'), { document: { currentScript: { dataset: { url: 'https://calendar.example/ali/demo' }, parentNode: { insertBefore() {} } }, documentElement: root, createElement: () => frame },
    window: { addEventListener() {} }, URL, location: { href: 'https://website.example' }, getComputedStyle: () => ({ colorScheme: 'normal' }),
    MutationObserver: class { constructor(cb: () => void) { observe = cb } observe() {} }, Intl })
  expect(frame.src).toContain('theme=dark')
  changed()
  expect(messages.at(-1)).toEqual([{t:'cadence:theme:1',theme:'dark'}, 'https://calendar.example'])
  root.dataset.theme = 'light'
  observe()
  expect(messages.at(-1)).toEqual([{t:'cadence:theme:1',theme:'light'}, 'https://calendar.example'])
})
