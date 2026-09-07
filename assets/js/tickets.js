;(function () {
  'use strict'

  // Reads the same localStorage the scrub screen writes. Nothing here talks to
  // the server, and nothing here can talk to Trac, so every column is either
  // something the CSV carried or something this console recorded itself.

  const POOL_KEY = 'testflow_console_options'
  const HISTORY_KEY = 'testflow_console_history'

  function read (key, fallback) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : fallback
    } catch (e) {
      return fallback
    }
  }

  function qs (sel) { return document.querySelector(sel) }
  function cel (tag) { return document.createElement(tag) }

  // Mirrors the scrub screen, so a ticket reads the same on both.
  function source (url) {
    const u = String(url || '')
    if (-1 !== u.indexOf('core.trac.wordpress.org')) return 'Core'
    if (-1 !== u.indexOf('meta.trac.wordpress.org')) return 'Meta'
    if (-1 !== u.indexOf('themes.trac.wordpress.org')) return 'Themes'
    if (-1 !== u.indexOf('github.com/WordPress/gutenberg')) return 'Gutenberg'
    const gh = u.match(/github\.com\/WordPress\/([^\/]+)/i)
    if (gh) return gh[1]
    return 'Other'
  }

  function ticketId (url) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean)
      return '#' + parts[parts.length - 1]
    } catch (e) {
      return url
    }
  }

  // Twenty words, then an ellipsis. A scrub table is for scanning, and a full
  // Trac summary is often a paragraph.
  function shorten (text, words) {
    const clean = String(text || '').trim()

    if (!clean) {
      return ''
    }

    const parts = clean.split(/\s+/)

    return parts.length <= words ? clean : parts.slice(0, words).join(' ') + '...'
  }

  // Trac CSV exports timestamps in a few shapes depending on the query. Accept
  // a unix seconds value, a unix microseconds value, or a parseable date, and
  // say nothing rather than print a wrong date.
  function when (value) {
    const raw = String(value || '').trim()

    if (!raw) {
      return ''
    }

    if (/^\d{16}$/.test(raw)) {
      return new Date(parseInt(raw, 10) / 1000).toLocaleDateString()
    }

    if (/^\d{10}$/.test(raw)) {
      return new Date(parseInt(raw, 10) * 1000).toLocaleDateString()
    }

    const parsed = Date.parse(raw)

    return isNaN(parsed) ? raw : new Date(parsed).toLocaleDateString()
  }

  function levelLabel (level) {
    return level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Unset'
  }

  function build () {
    const session = read(POOL_KEY, {}) || {}
    const history = read(HISTORY_KEY, { entries: [] }) || { entries: [] }
    const pool = session.ticketPool || []
    const participants = session.participants || []

    const rows = pool.map(entry => {
      const url = entry.value
      const meta = entry.meta || {}

      // Who this console has ever handed this ticket to, and whether they
      // finished. History survives Reset Session, so this spans sessions.
      const seen = {}

      ;(history.entries || []).forEach(h => {
        if (h.url !== url) {
          return
        }

        if (!seen[h.username] || 'done' === h.status) {
          seen[h.username] = h.status || 'assigned'
        }
      })

      const testers = Object.keys(seen).map(name => ({ name, status: seen[name] }))

      // Live state comes from the current session, history from every session.
      const holder = participants.find(p => (p.tickets || []).indexOf(url) !== -1)
      const finisher = participants.find(p => (p.done || []).indexOf(url) !== -1)

      let state = 'In the pool'

      if (holder) {
        state = 'With @' + holder.username
      } else if (finisher) {
        state = 'Done by @' + finisher.username
      } else if (testers.some(t => 'done' === t.status)) {
        state = 'Done in an earlier session'
      } else if (testers.length) {
        state = 'Handed out before'
      }

      return { url, entry, meta, testers, state }
    })

    return rows
  }

  function render () {
    const host = qs('#tf-tickets-table')
    const summary = qs('#tf-tickets-summary')

    if (!host) {
      return
    }

    const openOnly = qs('#tf-tickets-open-only') && qs('#tf-tickets-open-only').checked
    let rows = build()

    if (openOnly) {
      rows = rows.filter(r => -1 === r.state.indexOf('Done'))
    }

    host.innerHTML = ''

    if (!rows.length) {
      summary.textContent = 'No tickets in the pool. Import a Trac CSV, or paste ticket ids, on the Patch Testing Scrub screen.'
      return
    }

    const withDetail = rows.filter(r => r.meta && r.meta.summary).length

    summary.textContent = rows.length + ' ticket' + (1 === rows.length ? '' : 's')
      + ', ' + withDetail + ' imported with detail, '
      + (rows.length - withDetail) + ' added by hand.'

    // One table per source. A core Trac ticket and a Gutenberg issue do not
    // share a milestone scheme, a component list or a workflow, so stacking
    // them in one table makes both harder to read. Groups keep the CSV export
    // whole while letting the screen stay honest about what came from where.
    const groups = {}

    rows.forEach(r => {
      const key = source(r.url)
      groups[key] = groups[key] || []
      groups[key].push(r)
    })

    // Core first because it is the usual bulk, then the rest alphabetically.
    const order = Object.keys(groups).sort((a, b) => {
      if (a === b) return 0
      if ('Core' === a) return -1
      if ('Core' === b) return 1
      return a < b ? -1 : 1
    })

    order.forEach(key => renderGroup(host, key, groups[key]))
  }

  function renderGroup (host, key, rows) {
    const heading = cel('h2')
    heading.className = 'tf-tickets-group'
    heading.textContent = key + ' (' + rows.length + ')'
    host.appendChild(heading)

    const table = cel('table')
    table.className = 'widefat tf-tickets-table'

    const head = cel('thead')
    const hr = cel('tr')

    // Trac carries milestones and components. GitHub does not, so those two
    // columns would be blank for every Gutenberg row. Drop them there rather
    // than print an empty column and call it data.
    const trac = 'Core' === key || 'Meta' === key || 'Themes' === key

    const cols = trac
      ? ['status', 'milestone', 'priority', 'component']
      : ['status']

    const labels = ['Ticket', 'Summary', 'Level']
      .concat(trac ? ['Status', 'Milestone', 'Priority', 'Component'] : ['State on GitHub'])
      .concat(['Created', 'Last change', 'Tested by', 'State'])

    labels.forEach(h => {
      const th = cel('th')
      th.textContent = h
      hr.appendChild(th)
    })

    head.appendChild(hr)
    table.appendChild(head)

    const body = cel('tbody')

    rows.forEach(r => {
      const tr = cel('tr')

      const tdId = cel('td')
      const a = cel('a')
      a.href = r.url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = ticketId(r.url)
      tdId.appendChild(a)
      tr.appendChild(tdId)

      const tdSum = cel('td')
      tdSum.className = 'tf-cell-summary-wide'
      tdSum.textContent = shorten(r.meta.summary, 20) || '(no summary, added by hand)'
      if (r.meta.summary) {
        tdSum.title = r.meta.summary
      }
      tr.appendChild(tdSum)

      const tdLevel = cel('td')
      tdLevel.textContent = levelLabel(r.entry.level)
      tr.appendChild(tdLevel)

      cols.forEach(k => {
        const td = cel('td')
        td.textContent = r.meta[k] || ''
        tr.appendChild(td)
      })

      const tdCreated = cel('td')
      tdCreated.textContent = when(r.meta.time)
      tr.appendChild(tdCreated)

      const tdChanged = cel('td')
      tdChanged.textContent = when(r.meta.changetime)
      tr.appendChild(tdChanged)

      const tdTesters = cel('td')

      if (!r.testers.length) {
        tdTesters.textContent = '-'
      } else {
        r.testers.forEach((t, i) => {
          if (i > 0) {
            tdTesters.appendChild(document.createTextNode(', '))
          }
          const chip = cel('span')
          chip.className = 'done' === t.status ? 'tf-status tf-status--done' : 'tf-status'
          chip.textContent = '@' + t.name
          chip.title = 'done' === t.status ? 'Reported back' : 'Assigned, no report recorded'
          tdTesters.appendChild(chip)
        })
      }

      tr.appendChild(tdTesters)

      const tdState = cel('td')
      tdState.textContent = r.state
      tr.appendChild(tdState)

      body.appendChild(tr)
    })

    table.appendChild(body)
    host.appendChild(table)
  }

  function toCsv () {
    const rows = build()
    const head = ['ticket', 'source', 'url', 'summary', 'level', 'status', 'milestone', 'priority',
      'component', 'created', 'last_change', 'tested_by', 'state']

    const lines = [head]

    rows.forEach(r => {
      lines.push([
        ticketId(r.url),
        source(r.url),
        r.url,
        r.meta.summary || '',
        r.entry.level || '',
        r.meta.status || '',
        r.meta.milestone || '',
        r.meta.priority || '',
        r.meta.component || '',
        when(r.meta.time),
        when(r.meta.changetime),
        r.testers.map(t => t.name + (('done' === t.status) ? ' (done)' : '')).join(' '),
        r.state
      ])
    })

    return lines.map(l => l.map(v => {
      const s = String(v)
      return /["|,|\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }).join(',')).join('\n')
  }

  function init () {
    render()

    const filter = qs('#tf-tickets-open-only')
    if (filter) {
      filter.addEventListener('change', render)
    }

    const exportBtn = qs('#tf-tickets-export')
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const blob = new Blob([toCsv()], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = cel('a')

        a.href = url
        a.download = 'testflow-tickets.csv'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      })
    }
  }

  if ('loading' === document.readyState) {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
}())
