(() => {
  const form = document.querySelector('.pu-appearance-form')
  if (!form) return
  const frame = form.querySelector('iframe')
  const stage = frame.parentElement
  const preview = form.querySelector('button[value="preview"]')
  const status = form.querySelector('[data-preview-status]')
  let timer
  function fit() {
    const width = form.elements.previewWidth.value === 'mobile' ? 390 : 1200
    const scale = Math.min(1, stage.clientWidth / width)
    if (!scale) return
    frame.style.width = width + 'px'
    frame.style.height = Math.floor(stage.clientHeight / scale) + 'px'
    frame.style.transform = 'scale(' + scale + ')'
    frame.style.left = (stage.clientWidth - width * scale) / 2 + 'px'
  }
  function update(event) {
    if (event.target.name === 'previewWidth') return fit()
    const published = document.querySelector('.pu-notice[data-appearance-published]')
    if (published) published.remove()
    if (event.target.type === 'color') {
      form.elements.namedItem('enable-' + event.target.name).checked = true
    }
    clearTimeout(timer)
    timer = setTimeout(() => {
      status.textContent = 'Updating preview…'
      form.requestSubmit(preview)
    }, 160)
  }
  form.addEventListener('change', update)
  form.addEventListener('input', event => { if (event.target.type === 'color' || (event.target.name === 'imageUrl' && event.target.validity.valid)) update(event) })
  form.addEventListener('submit', () => clearTimeout(timer))
  frame.addEventListener('load', () => {
    const rendered = frame.contentDocument?.querySelector('body[data-layout]')
    status.textContent = rendered ? 'Sample times. Changes go live when you publish.' : 'Preview unavailable. Check the message in the preview.'
  })
  if (matchMedia('(max-width: 740px)').matches) form.elements.previewWidth.value = 'mobile'
  preview.hidden = true
  stage.classList.add('pu-preview-fitted')
  new ResizeObserver(fit).observe(stage)
  fit()
})()
