;(function () {
  'use strict'

  // A native select renders its option list as browser chrome. With twenty
  // feed items and titles the length of a headline, Chrome draws a panel
  // wider than the card and taller than the viewport, and no stylesheet can
  // touch it. This replaces one with a listbox the page actually owns, so it
  // stays inside its column and the long titles wrap.
  //
  // The original select is kept in the DOM, hidden, and remains the source of
  // truth: existing code that reads .value or fires change keeps working.

  const OPEN_CLASS = 'is-open'

  function cel (tag, cls) {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    return el
  }

  function enhance (select) {
    if (!select || select.dataset.tfPicker) {
      return null
    }

    select.dataset.tfPicker = '1'

    const wrap = cel('div', 'tf-picker')
    const button = cel('button', 'tf-picker-button')
    const label = cel('span', 'tf-picker-label')
    const caret = cel('span', 'tf-picker-caret')
    const panel = cel('div', 'tf-picker-panel')
    const list = cel('ul', 'tf-picker-list')

    button.type = 'button'
    button.setAttribute('aria-haspopup', 'listbox')
    button.setAttribute('aria-expanded', 'false')
    caret.setAttribute('aria-hidden', 'true')
    caret.textContent = '▾'
    list.setAttribute('role', 'listbox')
    panel.hidden = true

    if (select.id) {
      button.setAttribute('aria-labelledby', select.id + '-tf-label')
      label.id = select.id + '-tf-label'
    }

    button.append(label, caret)
    panel.appendChild(list)
    wrap.append(button, panel)

    select.parentNode.insertBefore(wrap, select)
    wrap.appendChild(select)
    select.classList.add('tf-picker-native')

    let index = -1

    function syncLabel () {
      const opt = select.options[select.selectedIndex]
      label.textContent = opt ? opt.textContent : ''
      button.disabled = select.disabled || 0 === select.options.length
    }

    function close () {
      panel.hidden = true
      wrap.classList.remove(OPEN_CLASS)
      button.setAttribute('aria-expanded', 'false')
    }

    function choose (i) {
      if (i < 0 || i >= select.options.length) {
        return
      }

      select.selectedIndex = i
      select.dispatchEvent(new Event('change', { bubbles: true }))
      syncLabel()
      close()
      button.focus()
    }

    function highlight (i) {
      const items = list.querySelectorAll('.tf-picker-option')

      if (!items.length) {
        return
      }

      index = Math.max(0, Math.min(i, items.length - 1))

      items.forEach((el, n) => {
        el.classList.toggle('is-active', n === index)
        el.setAttribute('aria-selected', n === index ? 'true' : 'false')
      })

      items[index].scrollIntoView({ block: 'nearest' })
    }

    function build () {
      list.textContent = ''

      Array.prototype.forEach.call(select.options, (opt, i) => {
        const li = cel('li', 'tf-picker-option')

        li.setAttribute('role', 'option')
        li.textContent = opt.textContent
        li.title = opt.textContent

        if (opt.disabled) {
          li.classList.add('is-disabled')
        }

        li.addEventListener('click', () => {
          if (!opt.disabled) choose(i)
        })

        li.addEventListener('mousemove', () => highlight(i))

        list.appendChild(li)
      })

      syncLabel()
    }

    function open () {
      if (button.disabled) {
        return
      }

      build()
      panel.hidden = false
      wrap.classList.add(OPEN_CLASS)
      button.setAttribute('aria-expanded', 'true')
      highlight(select.selectedIndex < 0 ? 0 : select.selectedIndex)
    }

    button.addEventListener('click', () => {
      if (panel.hidden) { open() } else { close() }
    })

    button.addEventListener('keydown', e => {
      if ('ArrowDown' === e.key || 'Enter' === e.key || ' ' === e.key) {
        e.preventDefault()
        if (panel.hidden) { open() } else { choose(index) }
        return
      }

      if ('ArrowUp' === e.key && panel.hidden) {
        e.preventDefault()
        open()
      }
    })

    wrap.addEventListener('keydown', e => {
      if (panel.hidden) {
        return
      }

      if ('Escape' === e.key) { e.preventDefault(); close(); button.focus(); return }
      if ('ArrowDown' === e.key) { e.preventDefault(); highlight(index + 1); return }
      if ('ArrowUp' === e.key) { e.preventDefault(); highlight(index - 1); return }
      if ('Home' === e.key) { e.preventDefault(); highlight(0); return }
      if ('End' === e.key) { e.preventDefault(); highlight(select.options.length - 1); return }
      if ('Enter' === e.key || ' ' === e.key) { e.preventDefault(); choose(index) }
    })

    document.addEventListener('click', e => {
      if (!wrap.contains(e.target)) close()
    })

    // Options are refilled asynchronously once the feeds answer, so watch for
    // that rather than assuming the list is final when this runs.
    const observer = new MutationObserver(() => {
      syncLabel()
      if (!panel.hidden) build()
    })

    observer.observe(select, { childList: true })
    select.addEventListener('change', syncLabel)

    build()

    return { rebuild: build }
  }

  function enhanceAll (root) {
    (root || document).querySelectorAll('.tf-announce-select').forEach(enhance)
  }

  window.tfPicker = { enhance, enhanceAll }

  function init () {
    enhanceAll(document)
  }

  if ('loading' === document.readyState) {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
}())
