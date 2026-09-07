;(function () {
  'use strict'

  // Builds the plan document a first-time moderator is asked to send to a team
  // lead before running a scrub. Most of it already exists in the console: the
  // pool, the levels, the summaries. This screen supplies the framing and the
  // parts only the moderator knows, then exports the whole thing.

  const POOL_KEY = 'testflow_console_options'
  const SLACK_KEY = 'testflow_console_slack'
  const PLAN_KEY = 'testflow_console_plan'

  const cfg = window.tfConsolePlan || {}

  const FIELDS = [
    'title', 'date', 'time', 'channel', 'moderator', 'lead',
    'release', 'releaseTitle', 'deadline', 'poolIntro', 'spares', 'rules', 'docUrl'
  ]

  const state = { dropped: [] }

  function qs (sel) { return document.querySelector(sel) }
  function cel (tag, cls) { const el = document.createElement(tag); if (cls) el.className = cls; return el }

  function read (key, fallback) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : fallback
    } catch (e) {
      return fallback
    }
  }

  function save () {
    const out = { dropped: state.dropped }
    FIELDS.forEach(f => { out[f] = state[f] || '' })
    localStorage.setItem(PLAN_KEY, JSON.stringify(out))
  }

  function api (path, opts) {
    if (!cfg.restUrl) {
      return Promise.reject(new Error('The REST endpoint was not provided to this screen.'))
    }

    return fetch(cfg.restUrl.replace(/\/$/, '') + path, Object.assign({
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': cfg.nonce || '' }
    }, opts || {})).then(r => r.json().then(body => {
      if (!r.ok) throw new Error((body && body.message) || ('Request failed, status ' + r.status))
      return body
    }))
  }

  function toast (msg) {
    const el = qs('#tf-toast')
    if (!el) return
    el.textContent = msg
    el.classList.add('is-visible')
    setTimeout(() => el.classList.remove('is-visible'), 2600)
  }

  // ------------------------------------------------------------ the pool

  function ticketId (url) {
    const m = String(url || '').match(/(\d+)\s*$/)
    return m ? '#' + m[1] : String(url || '')
  }

  function source (url) {
    const u = String(url || '')
    if (-1 !== u.indexOf('core.trac.wordpress.org')) return 'Core'
    if (-1 !== u.indexOf('meta.trac.wordpress.org')) return 'Meta'
    if (-1 !== u.indexOf('themes.trac.wordpress.org')) return 'Themes'
    if (-1 !== u.indexOf('github.com/WordPress/gutenberg')) return 'Gutenberg'
    return 'Other'
  }

  function tiers () {
    const session = read(POOL_KEY, {}) || {}
    const pool = session.ticketPool || []
    const people = session.participants || []

    const holder = url => {
      const p = people.find(x => (x.tickets || []).indexOf(url) !== -1)
        || people.find(x => (x.done || []).indexOf(url) !== -1)
      return p ? '@' + p.username : ''
    }

    const out = { beginner: [], moderate: [], advanced: [], unset: [] }

    pool.forEach(t => {
      const key = t.level && out[t.level] ? t.level : 'unset'
      const meta = t.meta || {}

      out[key].push({
        id: ticketId(t.value),
        url: t.value,
        what: meta.summary || '',
        milestone: meta.milestone || '',
        source: source(t.value),
        who: holder(t.value)
      })
    })

    return out
  }

  function renderPoolNote () {
    const t = tiers()
    const total = t.beginner.length + t.moderate.length + t.advanced.length + t.unset.length
    const el = qs('#tf-plan-pool-note')

    if (!el) return

    if (!total) {
      el.textContent = 'The pool is empty. Import a Trac CSV or sync from GitHub on the scrub screen, and the tables here fill themselves in.'
      return
    }

    const bits = []
    if (t.beginner.length) bits.push(t.beginner.length + ' beginner')
    if (t.moderate.length) bits.push(t.moderate.length + ' moderate')
    if (t.advanced.length) bits.push(t.advanced.length + ' advanced')
    if (t.unset.length) bits.push(t.unset.length + ' with no level set')

    el.textContent = total + ' tickets in the pool: ' + bits.join(', ')
      + '. The tables below are built from these, so set the levels on the scrub screen before you export.'
  }

  // -------------------------------------------------------- dropped list

  function renderDropped () {
    const host = qs('#tf-plan-dropped-list')
    if (!host) return

    host.textContent = ''

    if (!state.dropped.length) {
      const p = cel('p', 'tf-thread-empty')
      p.textContent = 'Nothing dropped yet. If you shortlisted a ticket and then took it out, say so here.'
      host.appendChild(p)
      return
    }

    const list = cel('ul', 'tf-thread-list')

    state.dropped.forEach((row, i) => {
      const li = cel('li', 'tf-thread-item')
      const main = cel('div', 'tf-thread-main')

      const id = cel('span', 'tf-thread-name-text')
      id.textContent = row.ticket
      main.appendChild(id)

      const why = cel('span', 'tf-drop-reason')
      why.textContent = row.reason
      main.appendChild(why)

      const actions = cel('div', 'tf-thread-actions')
      const remove = cel('button', 'button button-small tf-thread-remove')

      remove.type = 'button'
      remove.textContent = 'Remove'
      remove.addEventListener('click', () => {
        state.dropped.splice(i, 1)
        save()
        renderDropped()
        build()
      })

      actions.appendChild(remove)
      li.append(main, actions)
      list.appendChild(li)
    })

    host.appendChild(list)
  }

  // ------------------------------------------------------------- output

  function esc (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }

  function tierRows (rows) {
    return rows.map(r => {
      const what = r.what || '(no summary, added by hand)'
      const extra = r.milestone ? ' — ' + r.milestone : ''
      return { id: r.id, what: what + extra, who: r.who, url: r.url, source: r.source }
    })
  }

  // ---------------------------------------------------------- the messages

  // A plan is read by somebody deciding whether to let you run the session,
  // so it has to show the actual wording you will use, not a description of
  // it. These are the same templates the scrub screen sends.
  //
  // Placeholders stay as placeholders. A lead reading "@username" understands
  // it stands for whoever turns up; a lead reading a name that will not be
  // there does not.
  // The bare title of whatever was picked, with the sentence this screen wraps
  // around it stripped back off. The Announcement template supplies its own
  // framing, so feeding it the whole release line reads as a stutter.
  function announcementSubject () {
    if (state.releaseTitle) {
      return state.releaseTitle
    }

    const first = String(state.release || '').split('\n')[0].trim()

    if (!first) {
      return '{the announcement}'
    }

    return first
      .replace(/^Before we get started,\s*/i, '')
      .replace(/\s*is now available for testing\.?$/i, '')
      .replace(/\.$/, '')
      .trim()
  }

  function readable (text) {
    return String(text || '')
      // @{username} first, or the @ ends up doubled.
      .replace(/@\{username\}/g, '@username')
      .replace(/\{username\}/g, '@username')
      .replace(/@\[USERNAME\]/g, '@username')
      .replace(/\[USERNAME\]/g, '@username')
      .replace(/\{url\}/g, '#ticket')
      .replace(/\[TICKET_URL\]/g, '#ticket')
      .replace(/\{participants\}/g, 'everyone who took part')
      .replace(/\{announcement\}/g, announcementSubject())
      // A substituted value that already ended in a full stop leaves two.
      .replace(/\.\./g, '.')
      .trim()
  }

  function section (key) {
    const all = cfg.messages || {}
    const data = all[key] || {}
    const items = data.items || (Array.isArray(data) ? data : [])

    // Notes and bullets are on-screen guidance for the moderator, not things
    // that get said in the channel, so they do not belong in the plan.
    return items
      .filter(it => !it.note && !it.bullet && it.text)
      .map(it => ({ label: it.label || '', text: readable(it.text) }))
      .filter(it => it.text)
  }

  function openingLines () {
    const out = section('opening')

    // The release status is written on this screen rather than coming from a
    // template, so it is slotted in where it is actually said: after the
    // welcome, before the invite.
    if (state.release || state.deadline) {
      const text = [state.release, state.deadline].filter(Boolean).join('\n')
      const at = Math.min(2, out.length)
      out.splice(at, 0, { label: 'Release status', text })
    }

    return out
  }

  function assigningLines () {
    return section('assignment').concat(section('monitoring'))
  }

  function closingLines () {
    return section('closing')
  }

  function buildMarkdown () {
    const t = tiers()
    const out = []
    const push = line => out.push(line)

    push('# ' + (state.title || 'Patch Testing Scrub'))
    push('')

    const head = [state.date, state.time, state.channel].filter(Boolean).join('  ·  ')
    if (head) push(head)
    if (state.moderator) push('Moderator: ' + state.moderator)
    push('')

    const quote = items => {
      items.forEach(it => {
        if (it.label) { push('**' + it.label + '**'); push('') }
        it.text.split('\n').forEach(line => push('> ' + line))
        push('')
      })
    }

    push('## 1. Opening')
    push('')
    quote(openingLines())

    push('## 2. Assigning')
    push('')
    quote(assigningLines())

    push('## 3. The ticket pool')
    push('')
    if (state.poolIntro) { push(state.poolIntro); push('') }

    const tierOrder = [
      ['Beginner', t.beginner],
      ['Moderate', t.moderate],
      ['Advanced', t.advanced],
      ['No level set', t.unset]
    ]

    tierOrder.forEach(([name, rows]) => {
      if (!rows.length) return

      push('### ' + name)
      push('')
      push('| Ticket | What | Assigned to |')
      push('| --- | --- | --- |')

      tierRows(rows).forEach(r => {
        push('| [' + r.id + '](' + r.url + ') | ' + r.what.replace(/\|/g, '\\|') + ' | ' + (r.who || '') + ' |')
      })

      push('')
    })

    if (state.spares) {
      const spares = state.spares.split('\n').map(s => s.trim()).filter(Boolean)
      if (spares.length) {
        push('Spares if someone finishes early: ' + spares.join(' · '))
        push('')
      }
    }

    if (state.dropped.length) {
      push('## 4. Dropped from the shortlist')
      push('')
      push('| Ticket | Reason it was removed |')
      push('| --- | --- |')
      state.dropped.forEach(r => push('| ' + r.ticket + ' | ' + r.reason.replace(/\|/g, '\\|') + ' |'))
      push('')
    }

    const rules = (state.rules || '').split('\n').map(s => s.trim()).filter(Boolean)

    if (rules.length) {
      push('## 5. How I plan to run it')
      push('')
      rules.forEach(r => push('- ' + r))
      push('')
    }

    push('## 6. Closing')
    push('')
    quote(closingLines())

    return out.join('\n')
  }

  function buildHtml () {
    const t = tiers()
    const out = []

    out.push('<h1>' + esc(state.title || 'Patch Testing Scrub') + '</h1>')

    const head = [state.date, state.time, state.channel].filter(Boolean).join('&nbsp; &middot; &nbsp;')
    if (head) out.push('<p>' + head + '</p>')
    if (state.moderator) out.push('<p>Moderator: ' + esc(state.moderator) + '</p>')

    const quote = items => {
      items.forEach(it => {
        if (it.label) out.push('<p><strong>' + esc(it.label) + '</strong></p>')
        out.push('<blockquote><p>' + esc(it.text).replace(/\n/g, '<br>') + '</p></blockquote>')
      })
    }

    out.push('<h2>1. Opening</h2>')
    quote(openingLines())

    out.push('<h2>2. Assigning</h2>')
    quote(assigningLines())

    out.push('<h2>3. The ticket pool</h2>')
    if (state.poolIntro) out.push('<p>' + esc(state.poolIntro).replace(/\n/g, '<br>') + '</p>')

    const tierOrder = [
      ['Beginner', t.beginner],
      ['Moderate', t.moderate],
      ['Advanced', t.advanced],
      ['No level set', t.unset]
    ]

    tierOrder.forEach(([name, rows]) => {
      if (!rows.length) return

      out.push('<h3>' + name + '</h3>')
      out.push('<table border="1" cellpadding="6" cellspacing="0"><thead><tr>'
        + '<th>Ticket</th><th>What</th><th>Assigned to</th></tr></thead><tbody>')

      tierRows(rows).forEach(r => {
        out.push('<tr><td><a href="' + esc(r.url) + '">' + esc(r.id) + '</a></td>'
          + '<td>' + esc(r.what) + '</td><td>' + esc(r.who) + '</td></tr>')
      })

      out.push('</tbody></table>')
    })

    if (state.spares) {
      const spares = state.spares.split('\n').map(s => s.trim()).filter(Boolean)
      if (spares.length) {
        out.push('<p>Spares if someone finishes early: ' + esc(spares.join(' · ')) + '</p>')
      }
    }

    if (state.dropped.length) {
      out.push('<h2>4. Dropped from the shortlist</h2>')
      out.push('<table border="1" cellpadding="6" cellspacing="0"><thead><tr>'
        + '<th>Ticket</th><th>Reason it was removed</th></tr></thead><tbody>')
      state.dropped.forEach(r => {
        out.push('<tr><td>' + esc(r.ticket) + '</td><td>' + esc(r.reason) + '</td></tr>')
      })
      out.push('</tbody></table>')
    }

    const rules = (state.rules || '').split('\n').map(s => s.trim()).filter(Boolean)

    if (rules.length) {
      out.push('<h2>5. How I plan to run it</h2><ul>')
      rules.forEach(r => out.push('<li>' + esc(r) + '</li>'))
      out.push('</ul>')
    }

    out.push('<h2>6. Closing</h2>')
    quote(closingLines())

    return out.join('\n')
  }

  function messageText () {
    const who = state.lead ? state.lead + ' ' : ''
    const what = state.title || 'the patch testing scrub'
    const when = [state.date, state.time].filter(Boolean).join(', ')

    const lines = [
      who + 'here is my plan for ' + what + (when ? ', ' + when : '') + '.',
      ''
    ]

    if (state.docUrl) {
      lines.push(state.docUrl)
      lines.push('')
    }

    const t = tiers()
    const total = t.beginner.length + t.moderate.length + t.advanced.length + t.unset.length

    lines.push('It covers the opening messages, ' + total + ' tickets sorted into beginner, moderate and advanced'
      + (state.dropped.length ? ', the ' + state.dropped.length + ' I dropped from the shortlist and why' : '')
      + ', and how I intend to run the room.')

    lines.push('')
    lines.push('Happy to change anything before the session.')

    return lines.join('\n')
  }

  function build () {
    const preview = qs('#tf-plan-preview')
    if (preview) preview.innerHTML = buildHtml()

    const msg = qs('#tf-plan-message')
    if (msg) msg.textContent = messageText()
  }

  // ------------------------------------------------------------ clipboard

  function copyPlain (text, okMsg) {
    const status = qs('#tf-plan-status')
    const done = () => { if (status) status.textContent = okMsg }
    const failed = () => { if (status) status.textContent = 'Could not reach the clipboard. Select the preview and copy it by hand.' }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(failed)
      return
    }

    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;top:-1000px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      done()
    } catch (e) {
      failed()
    }
  }

  // Rich copy keeps headings and tables when pasted into Google Docs. Plain
  // text goes on the clipboard too, so a plain target still gets something
  // readable rather than a wall of markup.
  function copyRich () {
    const status = qs('#tf-plan-status')
    const html = buildHtml()
    const text = buildMarkdown()

    const ok = () => { if (status) status.textContent = 'Copied with formatting. Paste it straight into the document.' }

    if (navigator.clipboard && window.ClipboardItem) {
      const item = new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })

      navigator.clipboard.write([item]).then(ok).catch(() => copyViaSelection(html, ok, status))
      return
    }

    copyViaSelection(html, ok, status)
  }

  // Older path: put the markup in a live element, select it, and let the
  // browser copy the rendered selection.
  function copyViaSelection (html, ok, status) {
    try {
      const holder = document.createElement('div')
      holder.innerHTML = html
      holder.setAttribute('contenteditable', 'true')
      holder.style.cssText = 'position:fixed;left:-10000px;top:0;white-space:normal'
      document.body.appendChild(holder)

      const range = document.createRange()
      range.selectNodeContents(holder)

      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)

      document.execCommand('copy')
      sel.removeAllRanges()
      holder.remove()
      ok()
    } catch (e) {
      if (status) status.textContent = 'Could not copy with formatting. Use Copy as Markdown instead.'
    }
  }

  function download () {
    const blob = new Blob([buildMarkdown()], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = cel('a')
    const stamp = (state.date || '').replace(/[^0-9]/g, '') || 'plan'

    a.href = url
    a.download = 'scrub-plan-' + stamp + '.md'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function sendMessage () {
    const slack = read(SLACK_KEY, {}) || {}
    const status = qs('#tf-plan-send-status')

    if (!state.docUrl) {
      if (status) status.textContent = 'Paste the document link first, otherwise the message has nothing to point at.'
      return
    }

    const payload = { text: messageText(), target: 'channel' }
    if (slack.channel) payload.channel = slack.channel

    if (status) status.textContent = 'Sending...'

    api('/send', { method: 'POST', body: JSON.stringify(payload) })
      .then(() => { if (status) status.textContent = 'Sent.' ; toast('Sent to Slack') })
      .catch(e => { if (status) status.textContent = 'Not sent. ' + e.message })
  }

  // ------------------------------------------------------- announcements

  function loadReleases (force) {
    const picker = qs('#tf-plan-release-picker')
    if (!picker) return

    picker.innerHTML = '<option value="">Loading recent WordPress posts...</option>'

    api('/announcements' + (force ? '?refresh=1' : ''), { method: 'GET' })
      .then(r => {
        const items = r.items || []

        picker.innerHTML = ''

        const first = cel('option')
        first.value = ''
        first.textContent = items.length ? 'Pick a post to quote' : 'No posts came back'
        picker.appendChild(first)

        items.forEach(item => {
          const opt = cel('option')

          // The url goes in a data attribute, not in the value. An option
          // value is an HTML attribute, so a newline inside it collapses to a
          // space and the two halves can no longer be told apart.
          opt.value = item.title
          opt.dataset.url = item.link
          opt.textContent = (item.source ? '[' + item.source + '] ' : '') + item.title
          picker.appendChild(opt)
        })

        if (window.tfPicker) window.tfPicker.enhanceAll(document)
      })
      .catch(() => { picker.innerHTML = '<option value="">Could not reach the feeds</option>' })
  }

  // ---------------------------------------------------------------- boot

  function bindField (sel, key) {
    const el = qs(sel)
    if (!el) return

    el.value = state[key] || el.value || ''
    state[key] = el.value

    el.addEventListener('input', function () {
      state[key] = this.value
      save()
      build()
    })
  }

  function init () {
    const saved = read(PLAN_KEY, {}) || {}

    FIELDS.forEach(f => { state[f] = saved[f] || '' })
    state.dropped = Array.isArray(saved.dropped) ? saved.dropped : []

    bindField('#tf-plan-title', 'title')
    bindField('#tf-plan-date', 'date')
    bindField('#tf-plan-time', 'time')
    bindField('#tf-plan-channel', 'channel')
    bindField('#tf-plan-moderator', 'moderator')
    bindField('#tf-plan-lead', 'lead')
    bindField('#tf-plan-release', 'release')
    bindField('#tf-plan-deadline', 'deadline')
    bindField('#tf-plan-pool-intro', 'poolIntro')
    bindField('#tf-plan-spares', 'spares')
    bindField('#tf-plan-rules', 'rules')
    bindField('#tf-plan-doc-url', 'docUrl')

    const picker = qs('#tf-plan-release-picker')
    const releaseBox = qs('#tf-plan-release')

    if (picker && releaseBox) {
      picker.addEventListener('change', function () {
        if (!this.value) return

        const opt = this.options[this.selectedIndex]
        const url = opt ? (opt.dataset.url || '') : ''

        releaseBox.value = 'Before we get started, ' + this.value
          + ' is now available for testing.' + (url ? '\n' + url : '')

        state.release = releaseBox.value
        state.releaseTitle = this.value
        save()
        build()
      })

      loadReleases(false)
    }

    const refresh = qs('#tf-plan-release-refresh')
    if (refresh) refresh.addEventListener('click', () => loadReleases(true))

    const addDrop = qs('#tf-plan-drop-add')
    if (addDrop) {
      addDrop.addEventListener('click', () => {
        const t = qs('#tf-plan-drop-ticket')
        const r = qs('#tf-plan-drop-reason')

        if (!t.value.trim() || !r.value.trim()) {
          toast('A ticket and a reason, both')
          return
        }

        state.dropped.push({ ticket: t.value.trim(), reason: r.value.trim() })
        t.value = ''
        r.value = ''
        t.focus()
        save()
        renderDropped()
        build()
      })
    }

    const copyMd = qs('#tf-plan-copy-md')
    if (copyMd) copyMd.addEventListener('click', () => copyPlain(buildMarkdown(), 'Copied as Markdown.'))

    const copyRichBtn = qs('#tf-plan-copy-rich')
    if (copyRichBtn) copyRichBtn.addEventListener('click', copyRich)

    const dl = qs('#tf-plan-download')
    if (dl) dl.addEventListener('click', download)

    const copyMsg = qs('#tf-plan-copy-msg')
    if (copyMsg) copyMsg.addEventListener('click', () => copyPlain(messageText(), 'Message copied.'))

    const sendBtn = qs('#tf-plan-send-msg')
    if (sendBtn) sendBtn.addEventListener('click', sendMessage)

    const buildBtn = qs('#tf-plan-build')
    if (buildBtn) buildBtn.addEventListener('click', () => { build(); toast('Plan rebuilt from the current pool') })

    renderPoolNote()
    renderDropped()
    build()
  }

  if ('loading' === document.readyState) {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
}())
