;(function () {
  'use strict'

  // Everything on this screen is read, never written. The overview must never
  // be the thing that changes session state, or a moderator glancing at it
  // mid-scrub could lose work.

  const POOL_KEY = 'testflow_console_options'
  const HISTORY_KEY = 'testflow_console_history'
  const SLACK_KEY = 'testflow_console_slack'
  const CHAT_KEY = 'testflow_console_test_chat'
  const PLAN_KEY = 'testflow_console_plan'

  const cfg = window.tfConsoleOverview || {}

  function read (key, fallback) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : fallback
    } catch (e) {
      return fallback
    }
  }

  function qs (sel) { return document.querySelector(sel) }
  function set (sel, text) { const el = qs(sel); if (el) { el.textContent = text } }

  function ticketSource (url) {
    const u = String(url || '')
    if (-1 !== u.indexOf('core.trac.wordpress.org')) return 'Core'
    if (-1 !== u.indexOf('meta.trac.wordpress.org')) return 'Meta'
    if (-1 !== u.indexOf('themes.trac.wordpress.org')) return 'Themes'
    if (-1 !== u.indexOf('github.com/WordPress/gutenberg')) return 'Gutenberg'
    const gh = u.match(/github\.com\/WordPress\/([^/]+)/i)
    return gh ? gh[1] : 'Other'
  }

  function ago (ms) {
    if (!ms) return ''
    const mins = Math.round((Date.now() - ms) / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return mins + ' min ago'
    const hrs = Math.round(mins / 60)
    if (hrs < 24) return hrs + (1 === hrs ? ' hour ago' : ' hours ago')
    const days = Math.round(hrs / 24)
    return days + (1 === days ? ' day ago' : ' days ago')
  }

  // ---------------------------------------------------------------- state

  function readState () {
    const session = read(POOL_KEY, {}) || {}
    const history = read(HISTORY_KEY, { entries: [] }) || { entries: [] }
    const slack = read(SLACK_KEY, {}) || {}
    const chat = read(CHAT_KEY, {}) || {}

    const pool = session.ticketPool || []
    const people = session.participants || []
    const entries = history.entries || []

    const counts = {}
    pool.forEach(t => {
      const s = ticketSource(t.value)
      counts[s] = (counts[s] || 0) + 1
    })

    return {
      session,
      slack,
      chat,
      pool,
      people,
      entries,
      counts,
      levelled: pool.filter(t => t.level).length,
      assigned: people.reduce((n, p) => n + ((p.tickets || []).length), 0),
      done: people.reduce((n, p) => n + ((p.done || []).length), 0)
    }
  }

  function renderStrip (s) {
    const started = s.session.sessionStartedAt

    if (started) {
      set('#tf-ov-session', 'running')
      set('#tf-ov-session-sub', 'started ' + ago(started))
      qs('#tf-ov-session').classList.add('is-live')
    } else {
      set('#tf-ov-session', 'not started')
      set('#tf-ov-session-sub', s.pool.length || s.people.length ? 'lists are populated, timer is not running' : 'nothing set up yet')
    }

    set('#tf-ov-people', String(s.people.length))
    set('#tf-ov-people-sub', s.people.length
      ? s.assigned + ' holding a ticket, ' + s.done + ' finished'
      : 'pull them from Slack, or type them in')

    set('#tf-ov-tickets', String(s.pool.length))

    const names = Object.keys(s.counts).sort()
    set('#tf-ov-tickets-sub', names.length
      ? names.map(n => s.counts[n] + ' ' + n).join(', ')
      : 'import a CSV, or sync from GitHub')

    set('#tf-ov-history', String(s.entries.length))
  }

  function renderCards (s) {
    document.querySelectorAll('.tf-card-state').forEach(el => {
      const which = el.dataset.screen

      if ('scrub' === which) {
        el.textContent = s.session.sessionStartedAt
          ? 'A session is running right now.'
          : (s.pool.length ? s.pool.length + ' tickets are waiting in the pool.' : 'No session in progress.')
        return
      }

      if ('tickets' === which) {
        const withDetail = s.pool.filter(t => t.meta && t.meta.summary).length
        el.textContent = s.pool.length
          ? s.pool.length + ' tickets, ' + withDetail + ' with detail.'
          : 'The pool is empty.'
        return
      }

      if ('chat' === which) {
        el.textContent = s.chat.facilitator
          ? 'Facilitator set to ' + s.chat.facilitator + '.'
          : 'No facilitator set yet.'
        return
      }

      if ('plan' === which) {
        const plan = read(PLAN_KEY, {}) || {}

        if (plan.title || plan.date) {
          el.textContent = 'A plan is in progress'
            + (plan.date ? ' for ' + plan.date : '')
            + (plan.dropped && plan.dropped.length ? ', ' + plan.dropped.length + ' tickets dropped' : '')
            + '.'
          return
        }

        el.textContent = s.pool.length
          ? 'Ready to build from ' + s.pool.length + ' tickets.'
          : 'Fill the ticket pool first.'
      }
    })
  }

  function renderChecklist (s, slackStatus) {
    const state = {
      token: !!(slackStatus && slackStatus.token_configured),
      channel: !!(s.slack.channel || s.slack.url),
      invited: null, // Slack only tells us when a call fails, so never claim it.
      tickets: s.pool.length > 0,
      levels: s.pool.length > 0 && s.levelled === s.pool.length,
      timer: !!s.session.sessionStartedAt
    }

    document.querySelectorAll('#tf-ov-checklist li').forEach(li => {
      const key = li.dataset.check
      const value = state[key]

      li.classList.remove('is-done', 'is-todo', 'is-unknown')

      if (null === value) {
        li.classList.add('is-unknown')
        return
      }

      li.classList.add(value ? 'is-done' : 'is-todo')
    })

    // A pool where only some tickets carry a level is worth calling out, since
    // the unmarked ones all sort as advanced and quietly skew assignment.
    const levels = document.querySelector('#tf-ov-checklist li[data-check="levels"]')

    if (levels && s.pool.length && s.levelled < s.pool.length) {
      const note = document.createElement('span')
      note.className = 'tf-check-note'
      note.textContent = ' (' + s.levelled + ' of ' + s.pool.length + ' have one)'
      levels.appendChild(note)
    }
  }

  function renderRecent (s) {
    const host = qs('#tf-ov-recent')

    if (!host) return

    if (!s.entries.length) {
      host.textContent = 'Nothing assigned through this console yet. Once you start handing out tickets, the last few sessions show here.'
      return
    }

    // Group history by session id so "recent sessions" means sessions, not rows.
    const bySession = {}

    s.entries.forEach(e => {
      // Field names come from what the scrub screen actually writes: `session`
      // and `ts`, plus `doneTs` when the person reported back.
      const id = e.session || 'unknown'
      const stamp = e.doneTs || e.ts || 0

      bySession[id] = bySession[id] || { id, count: 0, done: 0, people: {}, last: 0 }
      bySession[id].count++
      if ('done' === e.status) bySession[id].done++
      if (e.username) bySession[id].people[e.username] = true
      if (stamp > bySession[id].last) bySession[id].last = stamp
    })

    const sessions = Object.keys(bySession)
      .map(k => bySession[k])
      .sort((a, b) => b.last - a.last)
      .slice(0, 5)

    const ul = document.createElement('ul')
    ul.className = 'tf-recent-list'

    sessions.forEach(sess => {
      const li = document.createElement('li')
      const when = sess.last ? ago(sess.last) : 'undated'
      const people = Object.keys(sess.people).length

      li.textContent = sess.count + ' assigned, ' + sess.done + ' finished, '
        + people + (1 === people ? ' person' : ' people') + ', ' + when

      ul.appendChild(li)
    })

    host.textContent = ''
    host.appendChild(ul)
  }

  // ------------------------------------------------------------- the brief

  function briefText () {
    const lines = [
      '*Testing a patch, the short version*',
      '',
      '1. Spin up a test site. https://playground.wordpress.net/ is quickest and needs nothing installed.',
      '2. Apply the patch, through Playground or Grunt.',
      '3. Run the reproduction steps on the ticket.',
      '4. Check it fixes the problem *and* that it does not break something else. Finding a regression is as useful as confirming a fix.',
      '5. Post your report on the ticket, then say so here and I will send you another.',
      '',
      '*A report needs:*',
      '- Environment: WP version, PHP version, server, database, browser, OS, active theme and plugins',
      '- Steps taken',
      '- Expected result',
      '- Actual result, ending in a pass or fail',
      '- Screenshots before and after',
      '- Anything else worth knowing',
      '',
      'The Test Reports plugin fills the environment block in for you and formats it for Trac or GitHub: https://wordpress.org/plugins/test-reports/',
      '',
      'Handbook: https://make.wordpress.org/test/handbook/patch-testing/'
    ]

    return lines.join('\n')
  }

  function toolkitText () {
    return [
      'If you have ever wanted to help test but could not get a local WordPress install working, the *WordPress Contributor Toolkit 1.0* is worth a look.',
      '',
      'It is a desktop app that sets up a full wordpress-develop environment for you. Git, Node and npm come bundled, so there is nothing to install first.',
      '',
      'Link a Trac ticket and it shows the ticket, its pull requests and its patches, applies the work and runs it on a live site. Each ticket gets its own branch, so one environment covers a whole session.',
      '',
      'Windows, macOS on Apple Silicon and Linux.',
      '',
      'Announcement: https://make.wordpress.org/core/2026/08/14/wordpress-contributor-toolkit-1-0-a-smoother-workflow-for-your-first-core-contribution/',
      'Download: https://github.com/WordPress/contributor-toolkit/releases/tag/v1.0.0#downloads',
      'Getting started: https://wordpress.github.io/contributor-toolkit/guide/getting-started.html'
    ].join('\n')
  }

  function copyTo (text, statusSel, okMsg) {
    const status = qs(statusSel)

    const done = () => { if (status) status.textContent = okMsg }
    const failed = () => { if (status) status.textContent = 'Could not reach the clipboard. Select the text and copy it by hand.' }

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

  function copyBrief () {
    const status = qs('#tf-ov-copy-status')
    const text = briefText()

    const done = () => { if (status) status.textContent = 'Copied. Paste it into the channel.' }
    const failed = () => { if (status) status.textContent = 'Could not reach the clipboard. Select the text above and copy it by hand.' }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(failed)
      return
    }

    // execCommand is deprecated but still the only fallback on http origins,
    // which is exactly where a local test site lives.
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

  // ------------------------------------------------------------------ boot

  function slackStatus () {
    if (!cfg.restUrl || !cfg.nonce) {
      return Promise.resolve(null)
    }

    return fetch(cfg.restUrl + '/webhook', {
      headers: { 'X-WP-Nonce': cfg.nonce },
      credentials: 'same-origin'
    })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
  }

  function renderSlack (status, s) {
    if (!status) {
      set('#tf-ov-slack', 'unknown')
      set('#tf-ov-slack-sub', 'could not ask the site')
      return
    }

    const hasToken = !!status.token_configured
    const hasHook = !!status.configured
    const hasChannel = !!(s.slack.channel || s.slack.url)

    if (hasToken && hasChannel) {
      set('#tf-ov-slack', 'ready')
      set('#tf-ov-slack-sub', status.token_rotating
        ? 'token saved, and it is a rotating one, so it will expire'
        : 'token and channel both set')
      const el = qs('#tf-ov-slack')
      if (el) el.classList.add('is-live')
      return
    }

    if (hasToken || hasHook) {
      set('#tf-ov-slack', 'partly set up')
      set('#tf-ov-slack-sub', hasChannel ? (hasToken ? 'token saved' : 'webhook only, cannot read the channel') : 'no channel link pasted yet')
      return
    }

    set('#tf-ov-slack', 'not connected')
    set('#tf-ov-slack-sub', 'set it up on the scrub screen')
  }

  function init () {
    const s = readState()

    renderStrip(s)
    renderCards(s)
    renderRecent(s)

    slackStatus().then(status => {
      renderSlack(status, s)
      renderChecklist(s, status)
    })

    const copy = qs('#tf-ov-copy-brief')
    if (copy) copy.addEventListener('click', copyBrief)

    const toolkit = qs('#tf-ov-copy-toolkit')
    if (toolkit) {
      toolkit.addEventListener('click', () => copyTo(toolkitText(), '#tf-ov-toolkit-status', 'Copied. Paste it into the channel.'))
    }

    const invite = qs('#tf-ov-invite')
    const inviteCopy = qs('#tf-ov-invite-copy')

    if (invite && inviteCopy) {
      inviteCopy.addEventListener('click', () => {
        invite.select()
        copyTo(invite.value, '#tf-ov-invite-note', 'Copied. Run it in the channel you want the console to use.')
      })
    }
  }

  if ('loading' === document.readyState) {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
}())
