(() => {
  const root = document.documentElement
  const behaviour = root.dataset.themeBehaviour || 'independent'
  const preview = root.hasAttribute('data-theme-preview')
  const valid = theme => theme === 'light' || theme === 'dark'
  if (!preview) {
    if (behaviour === 'light' || behaviour === 'dark') root.dataset.theme = behaviour
    else if (behaviour === 'website') {
      const theme = new URL(location.href).searchParams.get('theme')
      root.dataset.theme = valid(theme) ? theme : 'light'
      window.addEventListener('message', event => {
        if (window.parent === window || event.source !== window.parent) return
        if (event.data?.t === 'cadence:theme:1' && valid(event.data.theme)) root.dataset.theme = event.data.theme
      })
    } else {
      try {
        const theme = new URL(location.href).searchParams.get('theme') || localStorage.getItem('cadence_theme')
        if (valid(theme)) root.dataset.theme = theme
      } catch { /* Storage can be unavailable in private or embedded contexts. */ }
    }
  }
  document.addEventListener('DOMContentLoaded', () => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const dark = () => root.dataset.theme ? root.dataset.theme === 'dark' : media.matches
    function images() {
      const mode = dark() ? 'dark' : 'light'
      for (const [selector, attr] of [['[data-theme-light-src]', 'src'], ['[data-theme-light-href]', 'href']]) {
        for (const image of document.querySelectorAll(selector)) {
          const source = image.getAttribute('data-theme-' + mode + '-' + attr)
          if (source && image.getAttribute(attr) !== source) image.setAttribute(attr, source)
        }
      }
      for (const icon of document.querySelectorAll('[data-theme-icon]')) icon.hidden = icon.getAttribute('data-theme-icon') === mode
    }
    images()
    new MutationObserver(images).observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    media.addEventListener?.('change', images)
    const nav = document.querySelector('.pu-nav')
    const active = nav?.querySelector('[aria-current="page"]')
    if (active && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = active.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - active.offsetWidth) / 2
    }
    const toggle = document.querySelector('[data-theme-toggle]')
    if (!toggle) return
    if (preview || behaviour !== 'independent') { toggle.hidden = true; return }
    const label = () => { toggle.setAttribute('aria-label', `Switch to ${dark() ? 'light' : 'dark'} theme`); images() }
    label()
    toggle.addEventListener('click', () => {
      const theme = dark() ? 'light' : 'dark'
      root.dataset.theme = theme
      try { localStorage.setItem('cadence_theme', theme) } catch { /* The active theme still works. */ }
      label()
    })
  })
})()
