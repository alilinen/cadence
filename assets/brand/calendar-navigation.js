(() => {
  const main = document.querySelector('main[data-booking-calendar]')
  if (!main) return

  const calendarPath = location.pathname
  const status = document.createElement('p')
  status.className = 'pu-sr'
  status.setAttribute('role', 'status')
  main.after(status)
  let pending

  async function navigate(url, push = true, focusSelector) {
    url.hash = ''
    pending?.abort()
    const controller = new AbortController()
    pending = controller
    const timeout = setTimeout(() => controller.abort(), 10000)
    main.setAttribute('aria-busy', 'true')
    const times = main.querySelector('#cadence-times')
    if (times) times.inert = true
    status.textContent = 'Loading available times…'

    try {
      const response = await fetch(url.href, { signal: controller.signal, cache: 'no-store' })
      const destination = new URL(response.url)
      if (!response.ok || destination.origin !== location.origin || destination.pathname !== calendarPath) {
        throw new Error('Calendar response unavailable')
      }
      const page = new DOMParser().parseFromString(await response.text(), 'text/html')
      const next = page.querySelector('main[data-booking-calendar]')
      if (!next) throw new Error('Calendar content unavailable')
      if (pending !== controller) return

      main.innerHTML = next.innerHTML
      if (push) history.pushState(null, '', url.pathname + url.search)
      if (focusSelector) main.querySelector(focusSelector)?.focus({ preventScroll: true })
      const day = main.querySelector('#cadence-times h2')?.textContent
      status.textContent = day ? `${day}. Available times updated.` : 'Calendar updated. Choose a day.'
    } catch {
      // Keep the native navigation as recovery if a request or enhancement fails.
      if (pending === controller) location.assign(url.href)
    } finally {
      clearTimeout(timeout)
      if (pending === controller) {
        main.removeAttribute('aria-busy')
        const currentTimes = main.querySelector('#cadence-times')
        if (currentTimes) currentTimes.inert = false
        pending = undefined
      }
    }
  }

  document.addEventListener('click', event => {
    const link = event.target.closest?.('a.pu-day, a[data-calendar-nav]')
    if (!link || !main.contains(link) || event.defaultPrevented || event.button !== 0 ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return
    const url = new URL(link.href)
    if (url.origin !== location.origin || url.pathname !== calendarPath) return
    event.preventDefault()
    const focusSelector = event.detail === 0
      ? link.matches('.pu-day') ? '.pu-day[aria-selected="true"]' : `a[data-calendar-nav][aria-label="${link.getAttribute('aria-label')}"]`
      : undefined
    void navigate(url, true, focusSelector)
  })

  document.addEventListener('submit', event => {
    const form = event.target
    if (!main.contains(form) || !form.matches('.pu-tz-form')) return
    const url = new URL(form.action)
    if (url.origin !== location.origin || url.pathname !== calendarPath) return
    event.preventDefault()
    url.search = new URLSearchParams(new FormData(form)).toString()
    void navigate(url, true, '#pu-tz')
  })

  window.addEventListener('popstate', () => {
    if (location.pathname === calendarPath) void navigate(new URL(location.href), false)
  })

  if (location.hash === '#cadence-times') {
    history.replaceState(null, '', location.pathname + location.search)
    window.scrollTo(0, 0)
  }
})()
