;(function () {
  'use strict'

  // The thread field used to be a raw textarea: one "Name | url" per line,
  // edited as text. That is fine for one thread and miserable for five, and
  // a mistyped line failed silently at send time.
  //
  // This turns the same storage into a list you add to, edit and remove from.
  // The textarea stays underneath as the source of truth so the scrub screen
  // and Test Chat keep reading exactly what they read before.

  const SLACK_KEY = 'testflow_console_slack'

  function cel (tag, cls) {
    const el = document.createElement(tag)
    if (cls) el.className = cls
    return el
  }

  // Accepts a bare permalink or "Name | permalink". Anything without a
  // recognisable message link is reported rather than stored, because a bad
  // line here becomes a failed send later.
  function parseLine (line) {
    const raw = String(line || '').trim()

    if (!raw) {
      return null
    }

    let name = ''
    let url = raw
    const bar = raw.indexOf('|')

    if (-1 !== bar) {
      name = raw.slice(0, bar).trim()
      url = raw.slice(bar + 1).trim()
    }

    const m = url.match(/\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/i)

    return {
      name,
      url,
      channel: m ? m[1].toUpperCase() : '',
      ts: m ? m[2] + '.' + m[3] : '',
      valid: !!m
    }
  }

  function serialise (entries) {
    return entries.map(e => (e.name ? e.name + ' | ' + e.url : e.url)).join('\n')
  }

  function attach (textarea, opts) {
    if (!textarea || textarea.dataset.tfThreads) {
      return null
    }

    textarea.dataset.tfThreads = '1'

    const onChange = (opts && opts.onChange) || function () {}

    const host = cel('div', 'tf-threads')
    const listEl = cel('ul', 'tf-thread-list')
    const empty = cel('p', 'tf-thread-empty')

    const addBtn = cel('button', 'button button-small tf-thread-add')
    const form = cel('div', 'tf-thread-form')
    const nameInput = cel('input', 'tf-text-input tf-thread-name')
    const urlInput = cel('textarea', 'tf-pool-textarea tf-thread-url')
    const saveBtn = cel('button', 'button button-small button-primary')
    const cancelBtn = cel('button', 'button button-small')
    const status = cel('p', 'tf-thread-status')

    addBtn.type = 'button'
    addBtn.textContent = 'Add a thread'
    saveBtn.type = 'button'
    saveBtn.textContent = 'Add'
    cancelBtn.type = 'button'
    cancelBtn.textContent = 'Cancel'

    nameInput.type = 'text'
    nameInput.placeholder = 'Name, optional. Volunteers, Reports, Props'
    urlInput.rows = 3
    urlInput.placeholder = 'https://yourteam.slack.com/archives/C03B0H5J0/p1700000000000000'
    urlInput.setAttribute('aria-label', 'Thread links')

    const nameLabel = cel('label', 'tf-pool-label')
    nameLabel.textContent = 'Name'
    nameLabel.appendChild(nameInput)

    const urlLabel = cel('label', 'tf-pool-label')
    urlLabel.appendChild(document.createTextNode('Thread link'))

    const urlHint = cel('span', 'tf-pool-hint')
    urlHint.textContent = 'paste several at once, one per line'
    urlLabel.appendChild(urlHint)
    urlLabel.appendChild(urlInput)

    const formActions = cel('div', 'tf-thread-form-actions')
    formActions.append(saveBtn, cancelBtn)

    form.append(nameLabel, urlLabel, formActions)
    form.hidden = true

    host.append(listEl, empty, addBtn, form, status)
    textarea.parentNode.insertBefore(host, textarea)
    textarea.classList.add('tf-threads-native')

    let entries = []
    let editing = -1

    function read () {
      entries = String(textarea.value || '')
        .split('\n')
        .map(parseLine)
        .filter(Boolean)
    }

    function write () {
      textarea.value = serialise(entries)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      onChange(entries)
    }

    function showForm (show) {
      form.hidden = !show
      addBtn.hidden = show

      if (show) {
        nameInput.focus()
      } else {
        editing = -1
        nameInput.value = ''
        urlInput.value = ''
        saveBtn.textContent = 'Add'
        urlHint.hidden = false
        status.textContent = ''
      }
    }

    function render () {
      listEl.textContent = ''
      empty.hidden = entries.length > 0
      empty.textContent = 'No threads yet. Messages go to the channel until you add one.'

      entries.forEach((entry, i) => {
        const li = cel('li', 'tf-thread-item')

        if (!entry.valid) {
          li.classList.add('is-invalid')
        }

        const main = cel('div', 'tf-thread-main')
        const title = cel('span', 'tf-thread-name-text')

        title.textContent = entry.name || ('Thread ' + (i + 1))
        main.appendChild(title)

        const link = cel('a', 'tf-thread-link')
        link.href = entry.url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        link.textContent = entry.valid ? entry.channel + ' · ' + entry.ts : entry.url
        link.title = entry.url
        main.appendChild(link)

        if (!entry.valid) {
          const warn = cel('span', 'tf-thread-warn')
          warn.textContent = 'not a message link, this one will be ignored'
          main.appendChild(warn)
        }

        const actions = cel('div', 'tf-thread-actions')

        const edit = cel('button', 'button button-small')
        edit.type = 'button'
        edit.textContent = 'Edit'
        edit.addEventListener('click', () => {
          editing = i
          nameInput.value = entry.name
          urlInput.value = entry.url
          saveBtn.textContent = 'Save'
          urlHint.hidden = true
          showForm(true)
        })

        const remove = cel('button', 'button button-small tf-thread-remove')
        remove.type = 'button'
        remove.textContent = 'Remove'
        remove.title = 'Remove this thread'
        remove.addEventListener('click', () => {
          entries.splice(i, 1)
          write()
          render()
        })

        actions.append(edit, remove)
        li.append(main, actions)
        listEl.appendChild(li)
      })
    }

    addBtn.addEventListener('click', () => showForm(true))
    cancelBtn.addEventListener('click', () => showForm(false))

    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim()
      const lines = urlInput.value.split('\n').map(l => l.trim()).filter(Boolean)

      if (!lines.length) {
        status.textContent = 'Paste a thread link first.'
        return
      }

      // Editing is one row by definition, so a multi-line paste there would be
      // ambiguous. Say so rather than quietly using the first line.
      if (editing > -1 && lines.length > 1) {
        status.textContent = 'Editing one thread, but ' + lines.length + ' links were pasted. Cancel and use Add instead.'
        return
      }

      const parsed = lines.map(l => parseLine(l.indexOf('|') === -1 && name && lines.length === 1 ? name + ' | ' + l : l)).filter(Boolean)
      const bad = parsed.filter(p => !p.valid).length

      if (editing > -1) {
        entries[editing] = parsed[0]
      } else {
        const known = {}
        entries.forEach(e => { known[e.url] = true })

        let added = 0
        let skipped = 0

        parsed.forEach(p => {
          if (known[p.url]) { skipped++; return }
          known[p.url] = true
          entries.push(p)
          added++
        })

        status.textContent = added + ' added'
          + (skipped ? ', ' + skipped + ' already listed' : '')
          + (bad ? ', ' + bad + ' not a message link' : '')
      }

      write()
      render()

      if (editing > -1 || !bad) {
        showForm(false)
      } else {
        // Leave the form open so the bad line can be corrected in place.
        nameInput.value = ''
        urlInput.value = ''
      }
    })

    read()
    render()

    return {
      refresh: function () { read(); render() },
      entries: function () { return entries.slice() }
    }
  }

  window.tfThreads = { attach, parseLine, serialise, SLACK_KEY }
}())
