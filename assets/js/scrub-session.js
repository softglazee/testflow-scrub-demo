;(function () {
  'use strict'

  const STORAGE_KEY = 'testflow_console_options'
  const HISTORY_KEY = 'testflow_console_history'
  const SLACK_KEY   = 'testflow_console_slack'
  const WARN_SECONDS = 50 * 60
  const CHIME_SECONDS = 55 * 60

  // ── State ────────────────────────────────────────────────────

  const state = {
    participants: [],
    nextId: 1,
    participantPool: [],
    ticketPool: [],
    elapsedAtStart: 0,
    startTimestamp: null,
    timerRunning: false,
    timerInterval: null,
    wasRunningBeforeEdit: false,
    chimePlayed: false,
    sessionId: null,
    sessionStartedAt: null,
    history: { version: 1, entries: [] },
    slack: { url: '', team: '', channel: '', thread: '', target: 'their', active: 0, pullFrom: 'thread', live: false, propsUrl: '', propsChannel: '', moderator: '', autoSend: false },
    webhook: null,
    handles: {},
    pulled: []
  }

  // ── Message templates ────────────────────────────────────────

  // ── Template engine ──────────────────────────────────────────

  function applyTemplate( tmpl, vars ) {
    return tmpl.replace( /\{(\w+)\}/g, ( _, key ) => key in vars ? vars[ key ] : '' )
  }

  function getSectionItems( section ) {
    const data = window.tfConsoleScrub && window.tfConsoleScrub.messages[ section ]
    if ( ! data ) return []
    return Array.isArray( data ) ? data : ( data.items || [] )
  }

  function getMsgByKey( section, key ) {
    const found = getSectionItems( section ).find( item => item.key === key )
    return found ? found.text : ''
  }

  function getMsgByPlaceholder( section, placeholder ) {
    const found = getSectionItems( section ).find( item => item.text && -1 !== item.text.indexOf( '{' + placeholder + '}' ) )
    return found ? found.text : ''
  }

  function formatParticipants( names ) {
    if ( 0 === names.length ) return '[participants]'
    if ( 1 === names.length ) return names[ 0 ]
    const last = names[ names.length - 1 ]
    return names.slice( 0, -1 ).join( ', ' ) + ' and ' + last
  }

  // ── Timer ────────────────────────────────────────────────────

  function pad(n) {
    return String(n).padStart(2, '0')
  }

  function getElapsed() {
    if (state.timerRunning && null !== state.startTimestamp) {
      return state.elapsedAtStart + Math.floor((Date.now() - state.startTimestamp) / 1000)
    }
    return state.elapsedAtStart
  }

  function playChime() {
    if (!(window.AudioContext || window.webkitAudioContext)) {
      return
    }

    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const now = ctx.currentTime
    const notes = [523.25, 659.25, 783.99]

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.type = 'sine'
      osc.frequency.value = freq

      const start = now + i * 0.18
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.25, start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 1.8)

      osc.start(start)
      osc.stop(start + 1.8)
    })
  }

  function updateTimerDisplay() {
    const elapsed = getElapsed()
    const el = qs('#tf-timer')
    el.textContent = `${pad(Math.floor(elapsed / 60))}:${pad(elapsed % 60)}`
    el.classList.toggle('is-warning', elapsed >= WARN_SECONDS)
  }

  function tickTimer() {
    updateTimerDisplay()

    if (!state.chimePlayed && getElapsed() >= CHIME_SECONDS) {
      state.chimePlayed = true
      playChime()
    }

    saveSessionState()
  }

  function toggleTimer() {
    if (state.timerRunning) {
      state.elapsedAtStart = getElapsed()
      state.startTimestamp = null
      clearInterval(state.timerInterval)
      state.timerRunning = false
      qs('#tf-timer-btn').textContent = '▶ Resume'
    } else {
      state.startTimestamp = Date.now()

      // The wall clock moment the session opened. Used as the lower bound when
      // reading the channel, so the pull covers this session and not the last
      // arbitrary twelve hours.
      if (!state.sessionStartedAt) {
        state.sessionStartedAt = Date.now()
      }

      state.timerInterval = setInterval(tickTimer, 1000)
      state.timerRunning = true
      qs('#tf-timer-btn').textContent = '⏸ Pause'
    }
    saveSessionState()
  }

  function resetTimer() {
    clearInterval(state.timerInterval)
    state.timerRunning = false
    state.timerInterval = null
    state.startTimestamp = null
    state.elapsedAtStart = 0
    state.chimePlayed = false
    qs('#tf-timer').textContent = '00:00'
    qs('#tf-timer').classList.remove('is-warning')
    qs('#tf-timer-btn').textContent = '▶ Start'
    saveSessionState()
  }

  // ── localStorage persistence ─────────────────────────────────

  // History ---------------------------------------------------
  // Kept in its own localStorage key on purpose, so Reset Session cannot wipe
  // it. The scope is deliberately narrow and the UI says so: this records what
  // this moderator assigned through this plugin, in this browser. It cannot
  // know about testing done directly on Trac, because Trac returns 403 to any
  // server side client, so there is nothing for the plugin to read.

  function newSessionId() {
    return 's' + Date.now()
  }

  // Slack deep links ------------------------------------------
  // Deliberately link only. There is no way for a plugin to borrow the Slack
  // session already open in the browser: the API needs an OAuth token no
  // matter which client you use, and same origin policy blocks the attempt
  // anyway. What a link DOES remove is hunting for the right channel tab.

  function loadSlack() {
    try {
      const raw = localStorage.getItem(SLACK_KEY)
      if (!raw) return { url: '', team: '', channel: '', thread: '', target: 'their', active: 0, pullFrom: 'thread', live: false, propsUrl: '', propsChannel: '', moderator: '', autoSend: false }
      const d = JSON.parse(raw)
      const team = (d && d.team) || ''
      const channel = (d && d.channel) || ''
      return {
        url: (d && d.url) || (team && channel ? channelUrlFrom(team, channel) : ''),
        team,
        channel,
        thread: (d && d.thread) || '',
        target: (d && d.target) || 'their',
        active: (d && d.active) || 0,
        pullFrom: (d && d.pullFrom) || 'thread',
        live: !!(d && d.live),
        propsUrl: (d && d.propsUrl) || '',
        propsChannel: (d && d.propsChannel) || '',
        moderator: (d && d.moderator) || '',
        autoSend: !!(d && d.autoSend)
      }
    } catch (e) {
      return { url: '', team: '', channel: '', thread: '', target: 'their', active: 0, pullFrom: 'thread', live: false, propsUrl: '', propsChannel: '', moderator: '', autoSend: false }
    }
  }

  function saveSlack() {
    localStorage.setItem(SLACK_KEY, JSON.stringify(state.slack))
  }

  function channelUrlFrom(team, channel) {
    return 'https://app.slack.com/client/' + encodeURIComponent(team) + '/' + encodeURIComponent(channel)
  }

  // Accepts whatever the moderator has in hand: the web client URL, an
  // archives permalink, the two IDs side by side, or a bare channel ID.
  function parseSlackUrl(raw) {
    const s = String(raw || '').trim()
    if (!s) return { team: '', channel: '' }

    let m = s.match(/app\.slack\.com\/client\/(T[A-Z0-9]+)\/([CGD][A-Z0-9]+)/i)
    if (m) return { team: m[1].toUpperCase(), channel: m[2].toUpperCase() }

    m = s.match(/\.slack\.com\/archives\/([CGD][A-Z0-9]+)/i)
    if (m) return { team: '', channel: m[1].toUpperCase() }

    m = s.match(/\b(T[A-Z0-9]{5,})\b[^A-Z0-9]+\b([CGD][A-Z0-9]{5,})\b/i)
    if (m) return { team: m[1].toUpperCase(), channel: m[2].toUpperCase() }

    m = s.match(/^([CGD][A-Z0-9]{5,})$/i)
    if (m) return { team: '', channel: m[1].toUpperCase() }

    return { team: '', channel: '' }
  }

  function slackChannelUrl() {
    const t = state.slack.team.trim()
    const c = state.slack.channel.trim()
    if (!t || !c) return ''
    return channelUrlFrom(t, c)
  }

  // The thread permalink is whatever Slack's "Copy link" gave you. It is
  // already a full URL, so it is used as is rather than rebuilt.
  function slackTargetUrl() {
    const entry = activeThread()

    if (entry && 0 === entry.url.indexOf('http')) {
      return entry.url
    }

    return slackChannelUrl()
  }

  function refreshSlackUi() {
    const status = qs('#tf-slack-status')
    const detected = qs('#tf-slack-detected')
    const openBtn = qs('#tf-slack-open')
    const barBtn = qs('#tf-clipboard-slack-btn')
    const url = slackTargetUrl()

    if (openBtn) openBtn.disabled = !url
    if (barBtn) barBtn.hidden = !url

    if (detected) {
      const t = state.slack.team.trim()
      const c = state.slack.channel.trim()

      if (!state.slack.url.trim()) {
        detected.textContent = ''
      } else if (t && c) {
        detected.textContent = 'Detected workspace ' + t + ' and channel ' + c + '.'
      } else if (c) {
        detected.textContent = 'Detected channel ' + c + ', but no workspace. Paste the app.slack.com URL to get both.'
      } else {
        detected.textContent = 'Could not read a channel out of that. Open the channel in a browser and copy the address bar.'
      }
    }

    if (!status) return

    if (!url) {
      status.textContent = 'Paste the channel URL to enable the Slack buttons.'
      return
    }

    const target = state.slack.target || 'channel'
    const hasThread = '' !== threadTs()

    if ('channel' === target) {
      status.textContent = 'Sends go to the channel.'
    } else if (!hasThread) {
      status.textContent = 'Sends go to the channel, because no thread link is set.'
    } else if ('both' === target) {
      status.textContent = 'Sends go into the thread and are broadcast to the channel.'
    } else {
      status.textContent = 'Sends go into the thread only.'
    }
  }

  // A named target means the second and later clicks reuse the tab this
  // plugin opened, rather than piling up new ones. A page cannot discover or
  // take over a tab you opened yourself, so the first click still opens one.
  function openSlack() {
    const url = slackTargetUrl()

    if (!url) {
      toast('Paste the channel URL first')
      return
    }

    const win = window.open(url, 'tfconsole-slack')

    if (win) {
      win.focus()
    }
  }

  // Webhook send ----------------------------------------------
  // The webhook URL never reaches the browser. Everything goes through the
  // plugin's own REST routes, which check the nonce and the capability, and
  // refuse any URL that is not a real hooks.slack.com endpoint.

  function api(path, opts) {
    const cfg = window.tfConsoleScrub || {}

    if (!cfg.restUrl) {
      return Promise.reject(new Error('The REST endpoint was not provided to this screen.'))
    }

    const base = cfg.restUrl.replace(/\/$/, '')

    return fetch(base + path, Object.assign({
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-WP-Nonce': cfg.nonce || ''
      }
    }, opts || {})).then(r => r.json().then(body => {
      if (!r.ok) {
        throw new Error((body && body.message) || ('Request failed, status ' + r.status))
      }
      return body
    }))
  }

  // Slack permalinks carry the parent timestamp as p<10 digits><6 digits>.
  // Turning it back into 1787065000.123456 is what makes a reply land in the
  // scrub thread rather than at the bottom of the channel.
  function threadTs() {
    const entry = activeThread()
    return entry ? tsFromUrl(entry.url) : ''
  }

  function webhookStatus(msg) {
    const el = qs('#tf-webhook-status')
    if (el) {
      el.textContent = msg
    }
  }

  function refreshWebhookUi(status) {
    if (status) {
      state.webhook = status
    }

    const configured = !!(state.webhook && state.webhook.configured)
    const canConfigure = !state.webhook || false !== state.webhook.can_configure

    const sendBtn = qs('#tf-clipboard-send-btn')
    if (sendBtn) {
      sendBtn.hidden = !configured
    }

    const save = qs('#tf-webhook-save')
    if (save) {
      save.disabled = !canConfigure
    }

    const clear = qs('#tf-webhook-clear')
    if (clear) {
      clear.disabled = !canConfigure || !configured
    }

    if (!state.webhook) {
      return
    }

    addSendButtons()
    refreshProps()

    if (configured) {
      webhookStatus('Saved: ' + state.webhook.hint)
    } else if (canConfigure) {
      webhookStatus('No webhook saved.')
    } else {
      webhookStatus('No webhook saved, and you do not have the capability to add one.')
    }
  }

  function loadWebhookStatus() {
    api('/webhook', { method: 'GET' })
      .then(s => {
        refreshWebhookUi(s)
        refreshTokenUi()
      })
      .catch(e => {
        webhookStatus(e.message)
        tokenStatus(e.message)
      })
  }

  // channel, thread, or both. "Both" is a threaded reply that Slack also
  // shows in the channel, which is its reply_broadcast behaviour.
  function currentTarget() {
    const picked = state.slack.target || 'their'

    if ('channel' === picked || 'their' === picked) {
      return 'channel'
    }

    // Asking for a thread without a thread link would silently post to the
    // channel, so say so rather than pretend.
    return threadTs() ? picked : 'channel'
  }

  function sendToSlack(text, forceTarget) {
    if (!text || !text.trim()) {
      toast('Nothing to send')
      return
    }

    const target = forceTarget || currentTarget()
    const payload = {
      text: signed(text),
      target,
      channel: state.slack.channel.trim()
    }

    if ('channel' !== target) {
      payload.thread_ts = threadTs()
    }

    webhookStatus('Sending...')

    api('/send', { method: 'POST', body: JSON.stringify(payload) })
      .then(r => {
        const where = r.broadcast
          ? 'Sent to the thread and the channel.'
          : (r.in_thread ? 'Sent into the thread.' : 'Sent to the channel.')

        const who = 'user' === r.as
          ? ''
          : ' Posted as the app, because the saved token is a bot token.'

        webhookStatus(where + who)
        toast('Sent to Slack')
      })
      .catch(e => {
        webhookStatus('Not sent. ' + e.message)
        toast('Slack send failed')
      })
  }

  // Thread pull -----------------------------------------------
  // Slack gives user IDs and display names. Trac tickets are assigned to
  // wp.org handles. There is no mapping between those two systems, so the
  // handle is offered as an editable guess and the moderator confirms it.
  // Once confirmed it is remembered, so this is a one time cost per person.

  const HANDLE_MAP_KEY = 'testflow_console_handles'

  // wp.org identity --------------------------------------------

  function wporgUrl(handle) {
    const clean = String(handle || '').trim().replace(/^@/, '')
    return clean ? 'https://profiles.wordpress.org/' + encodeURIComponent(clean) + '/' : ''
  }

  // A handle taken out of a Slack profile URL beats one guessed from a display
  // name, because somebody put it there on purpose.
  function handleFromWporgUrl(url) {
    const m = String(url || '').match(/profiles\.wordpress\.org\/([^\/?#]+)/i)
    return m ? m[1] : ''
  }

  function loadHandleMap() {
    try {
      const raw = localStorage.getItem(HANDLE_MAP_KEY)
      const d = raw ? JSON.parse(raw) : null
      return d && 'object' === typeof d ? d : {}
    } catch (e) {
      return {}
    }
  }

  function saveHandleMap() {
    localStorage.setItem(HANDLE_MAP_KEY, JSON.stringify(state.handles))
  }

  function tokenStatus(msg) {
    const el = qs('#tf-token-status')
    if (el) {
      el.textContent = msg
    }
  }

  function threadStatus(msg) {
    const el = qs('#tf-thread-status')
    if (el) {
      el.textContent = msg
    }
  }

  function refreshTokenUi() {
    const configured = !!(state.webhook && state.webhook.token_configured)
    const canConfigure = !state.webhook || false !== state.webhook.can_configure

    const save = qs('#tf-token-save')
    if (save) {
      save.disabled = !canConfigure
    }

    const clear = qs('#tf-token-clear')
    if (clear) {
      clear.disabled = !canConfigure || !configured
    }

    const pull = qs('#tf-thread-pull')
    if (pull) {
      pull.disabled = !configured
    }

    if (!state.webhook) {
      return
    }

    if (configured) {
      tokenStatus('Saved: ' + state.webhook.token_hint
        + (state.webhook.token_rotating
          ? '  This is a rotating token. Slack expires these every 12 hours, so it will stop working. Use a non rotating xoxb- token instead.'
          : ''))
    } else if (canConfigure) {
      tokenStatus('No token saved. The thread pull needs one.')
    } else {
      tokenStatus('No token saved, and you do not have the capability to add one.')
    }
  }

  function renderThreadPeople(people) {
    const host = qs('#tf-thread-report')
    if (!host) {
      return
    }

    host.innerHTML = ''

    if (!people || !people.length) {
      return
    }

    const table = cel('table')
    table.className = 'widefat tf-import-table'

    const thead = cel('thead')
    const hr = cel('tr')
    ;['Use', 'Slack name', 'Replies', 'wp.org handle', 'Level'].forEach(h => {
      const th = cel('th')
      th.textContent = h
      hr.appendChild(th)
    })
    thead.appendChild(hr)
    table.appendChild(thead)

    const tbody = cel('tbody')

    people.forEach(p => {
      const tr = cel('tr')
      tr.dataset.slackId = p.id

      const tdUse = cel('td')
      const cb = cel('input')
      cb.type = 'checkbox'
      cb.className = 'tf-thread-use'
      cb.checked = !p.is_bot
      tdUse.appendChild(cb)
      tr.appendChild(tdUse)

      const tdName = cel('td')
      tdName.textContent = p.name + (p.is_bot ? ' (bot)' : '')
        + (p.from && p.from.length > 1 ? ' (thread + channel)' : '')
      if (p.real) {
        tdName.title = p.real
      }
      tr.appendChild(tdName)

      const tdCount = cel('td')
      if (p.messages && p.messages.length) {
        const toggle = cel('button')
        toggle.type = 'button'
        toggle.className = 'tf-msg-toggle'
        toggle.textContent = p.replies + ' \u25be'
        toggle.title = 'Read what they said'
        toggle.addEventListener('click', () => toggleMessages(tr, p))
        tdCount.appendChild(toggle)
      } else {
        tdCount.textContent = String(p.replies)
      }
      tr.appendChild(tdCount)

      const tdHandle = cel('td')
      const input = cel('input')
      input.type = 'text'
      input.className = 'tf-text-input tf-thread-handle'

      // Preference order: a handle the moderator already corrected, then one
      // taken from the person's Slack profile field, then the display name.
      input.value = state.handles[p.id]
        || handleFromWporgUrl(p.wporg)
        || p.name

      input.setAttribute('aria-label', 'wp.org handle for ' + p.name)
      tdHandle.appendChild(input)

      const link = cel('a')
      link.className = 'tf-wporg-link'
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.textContent = 'profile'

      const syncLink = () => {
        const url = p.wporg || wporgUrl(input.value)
        link.href = url
        link.hidden = !url
        link.title = url ? 'Open ' + url : ''
      }

      syncLink()
      input.addEventListener('input', syncLink)

      if (p.wporg) {
        const badge = cel('span')
        badge.className = 'tf-wporg-badge'
        badge.textContent = 'from Slack profile'
        badge.title = p.wporg
        tdHandle.appendChild(badge)
      }

      tdHandle.appendChild(link)
      tr.appendChild(tdHandle)

      const tdLevel = cel('td')
      const sel = cel('select')
      sel.className = 'tf-level-select tf-thread-level'
      sel.appendChild(new Option(levelLabel(''), ''))
      LEVELS.forEach(l => sel.appendChild(new Option(levelLabel(l), l)))
      sel.value = poolLevel(state.participantPool, input.value) || ''
      tdLevel.appendChild(sel)
      tr.appendChild(tdLevel)

      tbody.appendChild(tr)
    })

    table.appendChild(tbody)
    host.appendChild(table)

    const note = cel('p')
    note.className = 'tf-import-note'
    note.textContent = 'Slack names are not wp.org handles. Correct any that differ before adding, and the correction is remembered next time.'
    host.appendChild(note)

    const btn = cel('button')
    btn.type = 'button'
    btn.className = 'button button-primary'
    btn.textContent = 'Add the ticked people'
    btn.addEventListener('click', () => addThreadPeople())
    host.appendChild(btn)
  }

  function slackTime(ts) {
    const seconds = parseFloat(ts)
    if (!seconds) {
      return ''
    }
    return new Date(seconds * 1000).toLocaleTimeString()
  }

  // Opens an extra row underneath the person showing what they actually wrote,
  // with a reply box. Reading the words is the point: "3 replies" does not tell
  // a moderator whether somebody is volunteering or stuck.
  function toggleMessages(tr, person) {
    const existing = tr.nextElementSibling

    if (existing && existing.classList.contains('tf-msg-detail')) {
      existing.parentNode.removeChild(existing)
      return
    }

    const detail = cel('tr')
    detail.className = 'tf-msg-detail'

    const td = cel('td')
    td.colSpan = 6

    const list = cel('ul')
    list.className = 'tf-msg-list'

    person.messages.forEach(m => {
      const li = cel('li')

      const when = cel('span')
      when.className = 'tf-msg-when'
      when.textContent = slackTime(m.ts)
      li.appendChild(when)

      const text = cel('span')
      text.className = 'tf-msg-body'
      text.textContent = m.text || '(no text, probably a file or a reaction)'
      li.appendChild(text)

      list.appendChild(li)
    })

    td.appendChild(list)

    const replyWrap = cel('div')
    replyWrap.className = 'tf-reply-wrap'

    const box = cel('textarea')
    box.className = 'tf-reply-box'
    box.rows = 2
    box.placeholder = 'Reply to @' + person.name

    const send = cel('button')
    send.type = 'button'
    send.className = 'button button-small button-primary'
    send.textContent = 'Send reply'
    send.disabled = !(state.webhook && state.webhook.configured)
    send.title = send.disabled ? 'Save an incoming webhook first' : 'Post this reply to Slack'
    send.addEventListener('click', () => {
      const body = box.value.trim()
      if (!body) {
        toast('Type a reply first')
        return
      }
      sendToSlack('@' + person.name + ' ' + body)
      box.value = ''
    })

    replyWrap.appendChild(box)
    replyWrap.appendChild(send)
    td.appendChild(replyWrap)

    detail.appendChild(td)
    tr.parentNode.insertBefore(detail, tr.nextSibling)
  }

  function addThreadPeople() {
    const rows = qsa('#tf-thread-report tbody tr')
    const lines = []
    const pending = {}
    let added = 0

    rows.forEach(tr => {
      const use = tr.querySelector('.tf-thread-use')
      const handle = tr.querySelector('.tf-thread-handle').value.trim()
      const level = tr.querySelector('.tf-thread-level').value

      if (!use.checked || !handle) {
        return
      }

      state.handles[tr.dataset.slackId] = handle

      const person = (state.pulled || []).find(x => x.id === tr.dataset.slackId)
      const msgs = person && person.messages ? person.messages : []

      pending[handle] = {
        wporg: (person && person.wporg) || wporgUrl(handle),
        slackId: tr.dataset.slackId,
        origin: person && person.from && person.from.length
          ? (person.from.length > 1 ? 'both' : person.from[0])
          : 'channel',
        lastTs: msgs.length ? (msgs[msgs.length - 1].root || msgs[msgs.length - 1].ts) : ''
      }

      lines.push(level ? handle + ' | ' + level : handle)
      added++
    })

    if (!added) {
      toast('Nothing ticked')
      return
    }

    saveHandleMap()

    const existing = poolValues(state.participantPool)
    const merged = state.participantPool.slice()

    lines.forEach(line => {
      const entry = parsePoolLine(line)
      if (-1 === existing.indexOf(entry.value)) {
        merged.push(entry)
        existing.push(entry.value)
      } else {
        const found = merged.find(e => e.value === entry.value)
        if (found && entry.level) {
          found.level = entry.level
        }
      }
    })

    state.participantPool = merged

    merged.forEach(entry => {
      const meta = pending[entry.value] || {}
      const already = state.participants.find(p => p.username === entry.value)

      if (already) {
        if (entry.level) {
          already.level = entry.level
        }
        if (meta.slackId) {
          already.slackId = meta.slackId
          already.origin = meta.origin
          already.lastTs = meta.lastTs
          already.wporg = meta.wporg || already.wporg
        }
      } else {
        state.participants.push({
          id: state.nextId++,
          username: entry.value,
          level: entry.level,
          tickets: [],
          done: [],
          slackId: meta.slackId || '',
          origin: meta.origin || '',
          lastTs: meta.lastTs || '',
          wporg: meta.wporg || '',
          route: ''
        })
      }
    })

    qs('#tf-participant-pool').value = serialisePool(state.participantPool)
    renderTable()
    refreshThanks()
    saveSessionState()
    threadStatus(added + ' added to the participant list.')
    toast(added + ' participants added')
  }

  // Merges two result sets by Slack user id, summing replies and keeping both
  // sets of messages, so "both" is a real union rather than one overwriting
  // the other.
  function mergePeople(a, b) {
    const byId = {}

    const add = (list, where) => {
      (list || []).forEach(p => {
        if (!byId[p.id]) {
          byId[p.id] = Object.assign({}, p, { messages: (p.messages || []).slice(), from: [] })
        } else {
          byId[p.id].replies += p.replies
          byId[p.id].messages = byId[p.id].messages.concat(p.messages || [])
        }

        if (-1 === byId[p.id].from.indexOf(where)) {
          byId[p.id].from.push(where)
        }
      })
    }

    add(a, 'thread')
    add(b, 'channel')

    return Object.keys(byId)
      .map(k => byId[k])
      .sort((x, y) => y.replies - x.replies)
  }

  // A thread link is the precise source. Without one, fall back to the channel
  // over a time window, which is broader and will pick up chatter as well.
  function pullThread(quiet) {
    const entry = activeThread()
    const channel = state.slack.channel.trim()
    const want = state.slack.pullFrom || 'thread'

    const useThread = ('thread' === want || 'both' === want) && entry
    const useChannel = ('channel' === want || 'both' === want) && channel

    if (!useThread && !useChannel) {
      threadStatus(entry || channel
        ? 'That source is not set up. Add a thread link, or paste the channel URL.'
        : 'Paste the channel URL above, or a thread link.')
      return
    }

    const sinceSession = state.sessionStartedAt
      ? Math.floor(state.sessionStartedAt / 1000)
      : 0

    const jobs = []

    if (useThread) {
      jobs.push(api('/thread?url=' + encodeURIComponent(entry.url), { method: 'GET' }))
    } else {
      jobs.push(Promise.resolve(null))
    }

    if (useChannel) {
      jobs.push(api('/thread?channel=' + encodeURIComponent(channel)
        + (sinceSession ? '&oldest=' + sinceSession : '&hours=12'), { method: 'GET' }))
    } else {
      jobs.push(Promise.resolve(null))
    }

    if (!quiet) {
      threadStatus('Reading...')
      renderThreadPeople(null)
    }

    Promise.all(jobs)
      .then(([t, c]) => {
        const people = mergePeople(t && t.people, c && c.people)

        if (!people.length) {
          threadStatus('Nothing found in that source yet.')
          return
        }

        const bits = []
        if (t) bits.push(t.people.length + ' from the thread')
        if (c) bits.push(c.people.length + ' from the channel'
          + (sinceSession ? ' since the session started' : ' in the last ' + c.hours + ' hours'))

        threadStatus(people.length + ' found: ' + bits.join(', ') + '.'
          + (quiet ? ' Updated ' + new Date().toLocaleTimeString() + '.' : ''))

        state.pulled = people
        savePulled()
        renderThreadPeople(people)
      })
      .catch(e => threadStatus(e.message))
  }

  // Live refresh ----------------------------------------------
  // Deliberately quiet: it does not blank the table while refreshing, because
  // a list that flickers every thirty seconds is worse than no list.

  let liveTimer = null

  function setLive(on) {
    state.slack.live = !!on
    saveSlack()

    if (liveTimer) {
      window.clearInterval(liveTimer)
      liveTimer = null
    }

    if (!on) {
      return
    }

    if (!(state.webhook && state.webhook.token_configured)) {
      threadStatus('Live updates need a saved token.')
      state.slack.live = false
      saveSlack()

      const box = qs('#tf-pull-live')
      if (box) {
        box.checked = false
      }

      return
    }

    pullThread(true)
    liveTimer = window.setInterval(() => pullThread(true), 30000)
  }

  // Send buttons -----------------------------------------------
  // Rather than adding a button to every row in the view by hand, one pass
  // puts a Send next to each existing Copy. That covers Opening, Assigning,
  // Monitoring and Closing without touching the message config at all.

  function resolveMessageFor(btn) {
    if (btn.dataset.msg) {
      return btn.dataset.msg
    }

    if ('tf-copy-announcement' === btn.id) {
      const input = qs('#tf-announcement')
      const val = input ? input.value.trim() : ''
      if (!val) {
        return ''
      }
      return applyTemplate(getMsgByPlaceholder('opening', 'announcement'), { announcement: val })
    }

    if ('tf-copy-thanks' === btn.id) {
      const preview = qs('#tf-thanks-preview')
      return preview ? (preview.dataset.msg || '') : ''
    }

    return ''
  }

  function addSendButtons() {
    const ready = !!(state.webhook && state.webhook.configured)

    qsa('.tf-copy-btn').forEach(btn => {
      let send = btn.parentNode.querySelector('.tf-send-btn')

      if (!send) {
        send = cel('button')
        send.type = 'button'
        send.className = 'tf-send-btn'
        send.textContent = 'Send'
        send.title = 'Post this message to Slack'
        send.addEventListener('click', () => {
          const text = resolveMessageFor(btn)
          if (!text) {
            toast('Nothing to send yet')
            return
          }
          // Opening, Assigning, Monitoring and Closing are session messages.
          // They address the room, not a person, so they are never threaded.
          sendToSlack(text, 'channel')
        })
        // Wrap the pair so they travel together and sit right aligned,
        // instead of Copy floating wherever the text ends.
        let group = btn.parentNode.querySelector('.tf-msg-actions')

        if (!group) {
          group = cel('div')
          group.className = 'tf-msg-actions'
          btn.parentNode.insertBefore(group, btn)
          group.appendChild(btn)
        }

        group.appendChild(send)
      }

      send.disabled = !ready
      send.title = ready
        ? 'Post this message to Slack'
        : 'Save an incoming webhook first'
    })
  }

  // Announcements ---------------------------------------------
  // Fetched server side from the WordPress feeds, because a moderator should
  // not have to go and find the latest release post mid session.

  function renderAnnouncements(items) {
    const sel = qs('#tf-announcement-picker')
    if (!sel) {
      return
    }

    sel.innerHTML = ''
    sel.appendChild(new Option('Recent WordPress posts, pick one to fill the box', ''))

    if (!items || !items.length) {
      sel.appendChild(new Option('Nothing came back from the feeds', ''))
      return
    }

    items.forEach(item => {
      const label = '[' + item.source + '] ' + item.date + '  ' + item.title
      const opt = new Option(label.length > 110 ? label.slice(0, 107) + '...' : label, item.link)
      opt.dataset.title = item.title
      sel.appendChild(opt)
    })
  }

  function loadAnnouncements(refresh) {
    const sel = qs('#tf-announcement-picker')
    if (!sel) {
      return
    }

    sel.innerHTML = ''
    sel.appendChild(new Option(refresh ? 'Refreshing...' : 'Loading recent WordPress posts...', ''))

    api('/announcements' + (refresh ? '?refresh=1' : ''), { method: 'GET' })
      .then(r => renderAnnouncements(r.items))
      .catch(() => {
        sel.innerHTML = ''
        sel.appendChild(new Option('Could not load the feeds. Type the announcement instead.', ''))
      })
  }

  // Props -----------------------------------------------------
  // Props go to whoever actually did something, so this is built from people
  // who were assigned or completed a ticket, not everyone in the room.

  function propsNames() {
    return state.participants
      .filter(p => p.tickets.length > 0 || (p.done && p.done.length > 0))
      .map(p => p.username)
  }

  function propsMessage() {
    const names = propsNames()

    if (!names.length) {
      return ''
    }

    return 'Props to ' + formatParticipants(names.map(n => '@' + n))
      + ' for testing during today\'s patch testing scrub.'
  }

  // Props go to the props channel, which is a different channel from the one
  // the scrub runs in. Falls back to the scrub channel if none is set, and the
  // UI says which it will use rather than leaving it to chance.
  function propsChannel() {
    return (state.slack.propsChannel || '').trim() || state.slack.channel.trim()
  }

  function refreshPropsTarget() {
    const el = qs('#tf-props-target')
    if (!el) {
      return
    }

    const own = (state.slack.propsChannel || '').trim()

    if (own) {
      el.textContent = 'Props will go to ' + own + ', separately from the scrub channel.'
    } else if (state.slack.channel.trim()) {
      el.textContent = 'No props channel set, so props will go to the scrub channel ' + state.slack.channel.trim() + '.'
    } else {
      el.textContent = ''
    }
  }

  function refreshProps() {
    const preview = qs('#tf-props-preview')
    const copyBtn = qs('#tf-props-copy')
    const sendBtn = qs('#tf-props-send')

    if (!preview) {
      return
    }

    const msg = propsMessage()
    const ready = '' !== msg

    preview.textContent = ready
      ? msg
      : 'Nobody has been assigned a ticket yet, so there is nobody to prop.'
    preview.classList.toggle('tf-preview--muted', !ready)
    preview.dataset.msg = msg

    if (copyBtn) {
      copyBtn.disabled = !ready
    }

    if (sendBtn) {
      sendBtn.disabled = !ready || !(state.webhook && state.webhook.configured)
    }
  }

  const PULLED_KEY = 'testflow_console_pulled'

  function savePulled() {
    try {
      localStorage.setItem(PULLED_KEY, JSON.stringify(state.pulled || []))
    } catch (e) {
      // A very chatty channel could exceed the quota. Losing the cache is
      // survivable, the button re-fetches.
    }
  }

  function loadPulled() {
    try {
      const raw = localStorage.getItem(PULLED_KEY)
      const d = raw ? JSON.parse(raw) : null
      return Array.isArray(d) ? d : []
    } catch (e) {
      return []
    }
  }

  // Thread list -----------------------------------------------
  // A scrub can run more than one thread: volunteers in one, reports in
  // another. Each line is an optional name, a pipe, then the permalink.

  function threadEntries() {
    return String(state.slack.thread || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const bar = line.indexOf('|')
        const name = -1 === bar ? '' : line.slice(0, bar).trim()
        const url = -1 === bar ? line : line.slice(bar + 1).trim()
        return { name, url }
      })
      .filter(e => e.url)
  }

  function activeThread() {
    const all = threadEntries()

    if (!all.length) {
      return null
    }

    const i = Math.min(Math.max(0, state.slack.active | 0), all.length - 1)
    return all[i]
  }

  function tsFromUrl(url) {
    const m = String(url || '').match(/\/p(\d{10})(\d{6})/)
    return m ? m[1] + '.' + m[2] : ''
  }

  function renderThreadPicker() {
    const sel = qs('#tf-thread-picker')
    if (!sel) {
      return
    }

    const all = threadEntries()
    sel.innerHTML = ''

    if (!all.length) {
      sel.appendChild(new Option('No thread links yet', ''))
      sel.disabled = true
      return
    }

    sel.disabled = false

    all.forEach((e, i) => {
      const ts = tsFromUrl(e.url)
      const label = (e.name || 'Thread ' + (i + 1)) + (ts ? '  (' + ts + ')' : '  (not a message link)')
      sel.appendChild(new Option(label, String(i)))
    })

    sel.value = String(Math.min(Math.max(0, state.slack.active | 0), all.length - 1))
  }

  // Routing ---------------------------------------------------
  // Where a message to a person should land depends on where that person is.
  // Somebody who spoke in the channel gets an answer in the channel, ideally
  // hung off their own message. Somebody who replied in the scrub thread gets
  // an answer in that thread. Session messages are different and never thread.

  const ROUTES = [
    { key: 'their', label: 'Reply to their message' },
    { key: 'channel', label: 'Channel, standalone' },
    { key: 'thread', label: 'Scrub thread' },
    { key: 'both', label: 'Scrub thread, shown in channel' }
  ]

  function defaultRouteFor(origin) {
    return 'channel' === origin ? 'their' : 'thread'
  }

  function routeFor(p) {
    if (p.route) {
      return p.route
    }

    const preferred = state.slack.target || 'their'

    return 'their' === preferred ? defaultRouteFor(p.origin) : preferred
  }

  // Turns a route into the parameters the send endpoint wants.
  function payloadForRoute(route, p, text) {
    const channel = state.slack.channel.trim()
    const base = { text, channel }

    if ('channel' === route) {
      return Object.assign(base, { target: 'channel' })
    }

    if ('their' === route) {
      // Hanging the reply off their own message only works if we know which
      // message that was. Without it, fall back to the channel rather than
      // quietly posting somewhere unexpected.
      if (p && p.lastTs) {
        return Object.assign(base, { target: 'thread', thread_ts: p.lastTs })
      }
      return Object.assign(base, { target: 'channel' })
    }

    const ts = threadTs()

    if (!ts) {
      return Object.assign(base, { target: 'channel' })
    }

    return Object.assign(base, { target: 'both' === route ? 'both' : 'thread', thread_ts: ts })
  }

  function describeRoute(route, p) {
    if ('channel' === route) return 'the channel'
    if ('their' === route) return p && p.lastTs ? 'a reply to their message' : 'the channel, no message of theirs is known'
    if (!threadTs()) return 'the channel, no scrub thread is set'
    return 'both' === route ? 'the scrub thread and the channel' : 'the scrub thread'
  }

  function sendForParticipant(p, text, route) {
    if (!text || !text.trim()) {
      toast('Nothing to send')
      return
    }

    const chosen = route || routeFor(p)
    const payload = payloadForRoute(chosen, p, signed(text))

    webhookStatus('Sending to ' + describeRoute(chosen, p) + '...')

    api('/send', { method: 'POST', body: JSON.stringify(payload) })
      .then(() => {
        webhookStatus('Sent to ' + describeRoute(chosen, p) + '.')
        toast('Sent to Slack')
      })
      .catch(e => {
        webhookStatus('Not sent. ' + e.message)
        toast('Slack send failed')
      })
  }

  // With a bot token every message reads as the app, so signing it is the only
  // way a reader knows who is actually running the session. Skipped when a user
  // token is in use, because then the message already carries a real name.
  function signed(text) {
    const who = (state.slack.moderator || '').trim().replace(/^@/, '')

    if (!who) {
      return text
    }

    if (state.webhook && 'user' === state.webhook.as) {
      return text
    }

    return text + '\n(' + who + ')'
  }

  // Ticket sources --------------------------------------------
  // The Test Team is not core only. Its handbook says testing "has grown to
  // encompass the entire WordPress ecosystem", and the 4th Thursday session is
  // a Gutenberg scrub. So a ticket carries where it came from, and the pool can
  // hold several kinds at once without them blurring together.

  function ticketSource(url) {
    const u = String(url || '')

    if (-1 !== u.indexOf('core.trac.wordpress.org')) return 'Core'
    if (-1 !== u.indexOf('meta.trac.wordpress.org')) return 'Meta'
    if (-1 !== u.indexOf('themes.trac.wordpress.org')) return 'Themes'
    if (-1 !== u.indexOf('github.com/WordPress/gutenberg')) return 'Gutenberg'

    const gh = u.match(/github\.com\/WordPress\/([^\/]+)/i)
    if (gh) return gh[1]

    return 'Other'
  }

  function sourceBreakdown() {
    const counts = {}

    poolValues(state.ticketPool).forEach(url => {
      const src = ticketSource(url)
      counts[src] = (counts[src] || 0) + 1
    })

    return counts
  }

  // Gutenberg import -------------------------------------------

  function importGutenberg() {
    const label = qs('#tf-gb-label') ? qs('#tf-gb-label').value : 'Needs Testing'
    const kind = qs('#tf-gb-kind') ? qs('#tf-gb-kind').value : 'issues'
    const status = msg => {
      const el = qs('#tf-gb-status')
      if (el) el.textContent = msg
    }

    status('Asking GitHub...')

    api('/gutenberg?label=' + encodeURIComponent(label) + '&kind=' + encodeURIComponent(kind), { method: 'GET' })
      .then(r => {
        const known = new Set(poolValues(state.ticketPool))
        let added = 0
        let skipped = 0

        r.items.forEach(item => {
          if (!item.url || known.has(item.url)) {
            skipped++
            return
          }

          known.add(item.url)

          state.ticketPool.push({
            value: item.url,
            level: levelFromKeywords(item.labels),
            meta: {
              summary: item.summary,
              status: item.status,
              keywords: item.labels,
              milestone: '',
              priority: '',
              type: 'pulls' === kind ? 'pull request' : 'issue',
              component: 'Gutenberg',
              owner: item.owner,
              time: item.time,
              changetime: item.changed
            }
          })

          added++
        })

        if (added) {
          qs('#tf-ticket-pool').value = serialisePool(state.ticketPool)
          renderTicketSelects()
          saveSessionState()
        }

        status(added + ' added, ' + skipped + ' already in the pool, from ' + r.items.length
          + ' open ' + kind + ' labelled "' + label + '".')
        toast(added + ' Gutenberg items imported')
      })
      .catch(e => status(e.message))
  }

  // Clean session ---------------------------------------------
  // Reset clears the working lists. This clears everything a session touches,
  // and deliberately keeps two things: the Slack setup, because retyping a
  // token before every scrub would be miserable, and the assignment history,
  // because that is what makes repeat detection work across sessions.

  function newSession() {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Start a clean session?\n\nThis empties participants, tickets, the pulled list, the timer and the imported report.\n\nIt keeps your Slack token, webhook, channel and thread links, and it keeps the assignment history.')) {
      return
    }

    clearInterval(state.timerInterval)

    state.timerRunning = false
    state.timerInterval = null
    state.startTimestamp = null
    state.elapsedAtStart = 0
    state.chimePlayed = false
    state.sessionStartedAt = null
    state.participants = []
    state.nextId = 1
    state.participantPool = []
    state.ticketPool = []
    state.pulled = []
    state.sessionId = newSessionId()

    localStorage.removeItem(PULLED_KEY)

    qs('#tf-timer').textContent = '00:00'
    qs('#tf-timer').classList.remove('is-warning')
    qs('#tf-timer-btn').textContent = '\u25b6 Start'
    qs('#tf-participant-pool').value = ''
    qs('#tf-ticket-pool').value = ''

    const clearIf = sel => {
      const el = qs(sel)
      if (el) el.value = ''
    }

    clearIf('#tf-announcement')
    clearIf('#tf-manual-tickets')
    clearIf('#tf-import-csv-text')

    const wipe = sel => {
      const el = qs(sel)
      if (el) el.innerHTML = ''
    }

    wipe('#tf-import-report')
    wipe('#tf-thread-report')

    const blank = sel => {
      const el = qs(sel)
      if (el) el.textContent = ''
    }

    blank('#tf-import-status')
    blank('#tf-thread-status')
    blank('#tf-manual-status')
    blank('#tf-gb-status')

    saveSessionState()
    renderParticipantSelects()
    renderTicketSelects()
    renderTable()
    refreshThanks()
    renderHistory()

    toast('Clean session ready')
  }

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      if (!raw) return { version: 1, entries: [] }
      const data = JSON.parse(raw)
      if (!data || !Array.isArray(data.entries)) return { version: 1, entries: [] }
      return { version: 1, entries: data.entries.filter(e => e && e.username && e.url) }
    } catch (e) {
      return { version: 1, entries: [] }
    }
  }

  function saveHistory() {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history))
  }

  function hasTested(username, url) {
    return state.history.entries.some(e => e.username === username && e.url === url)
  }

  function priorTesters(url, exclude) {
    const names = new Set()
    state.history.entries.forEach(e => {
      if (e.url === url && e.username !== exclude) {
        names.add(e.username)
      }
    })
    return [...names]
  }

  function recordAssignment(username, url) {
    state.history.entries.push({
      username,
      url,
      ts: Date.now(),
      session: state.sessionId,
      status: 'assigned'
    })
    saveHistory()
    renderHistory()
  }

  // Only drops entries from the current session. Anything from an earlier
  // session is a record of something that happened and is not ours to edit.
  function unrecordAssignment(username, url) {
    const before = state.history.entries.length
    state.history.entries = state.history.entries.filter(
      e => !(e.username === username && e.url === url && e.session === state.sessionId)
    )
    if (state.history.entries.length !== before) {
      saveHistory()
      renderHistory()
    }
  }

  function historyToCsv() {
    const rows = [['participant', 'ticket', 'status', 'iso_time', 'iso_done_time', 'session']]
    state.history.entries.forEach(e => {
      rows.push([
        e.username,
        e.url,
        e.status || 'assigned',
        e.ts ? new Date(e.ts).toISOString() : '',
        e.doneTs ? new Date(e.doneTs).toISOString() : '',
        e.session || ''
      ])
    })
    return rows.map(r => r.map(v => {
      const s = String(v)
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }).join(',')).join('\n')
  }

  function renderHistory() {
    const summary = qs('#tf-history-summary')
    const list = qs('#tf-history-list')
    if (!summary || !list) {
      return
    }

    const entries = state.history.entries
    list.innerHTML = ''

    if (0 === entries.length) {
      summary.textContent = 'Nothing recorded yet.'
      return
    }

    const sessions = new Set(entries.map(e => e.session)).size
    summary.textContent = entries.length + ' assignment' + (1 === entries.length ? '' : 's')
      + ' across ' + sessions + ' session' + (1 === sessions ? '' : 's') + '.'

    const table = cel('table')
    table.className = 'widefat tf-history-table'

    const thead = cel('thead')
    const hrow = cel('tr')
    ;['Participant', 'Ticket', 'Status', 'When', 'Session'].forEach(h => {
      const th = cel('th')
      th.textContent = h
      hrow.appendChild(th)
    })
    thead.appendChild(hrow)
    table.appendChild(thead)

    const tbody = cel('tbody')
    entries.slice().reverse().slice(0, 50).forEach(e => {
      const tr = cel('tr')

      const tdUser = cel('td')
      tdUser.textContent = '@' + e.username
      tr.appendChild(tdUser)

      const tdTicket = cel('td')
      const a = cel('a')
      a.href = e.url
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      a.textContent = ticketLabel(e.url)
      tdTicket.appendChild(a)
      tr.appendChild(tdTicket)

      const tdStatus = cel('td')
      const badge = cel('span')
      badge.className = 'done' === e.status ? 'tf-status tf-status--done' : 'tf-status'
      badge.textContent = 'done' === e.status ? 'done' : 'assigned'
      tdStatus.appendChild(badge)
      tr.appendChild(tdStatus)

      const tdWhen = cel('td')
      tdWhen.textContent = e.doneTs
        ? new Date(e.doneTs).toLocaleString()
        : (e.ts ? new Date(e.ts).toLocaleString() : '')
      tr.appendChild(tdWhen)

      const tdSession = cel('td')
      tdSession.textContent = e.session === state.sessionId ? 'this session' : 'earlier'
      tr.appendChild(tdSession)

      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    list.appendChild(table)

    if (entries.length > 50) {
      const note = cel('p')
      note.className = 'tf-history-note'
      note.textContent = 'Showing the 50 most recent. Export for the full record.'
      list.appendChild(note)
    }
  }

  function saveSessionState() {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        elapsedAtStart: state.elapsedAtStart,
        startTimestamp: state.startTimestamp,
        timerRunning: state.timerRunning,
        chimePlayed: state.chimePlayed,
        participants: state.participants,
        nextId: state.nextId,
        participantPool: state.participantPool,
        ticketPool: state.ticketPool,
        sessionId: state.sessionId,
        sessionStartedAt: state.sessionStartedAt
      })
    )
  }

  function loadSessionState() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return
    }

    try {
      const data = JSON.parse(raw)

      state.chimePlayed = data.chimePlayed || false
      state.participants = (data.participants || []).map(p => ({
        id: p.id,
        username: p.username,
        level: normLevel(p.level),
        tickets: p.tickets || (p.ticket ? [p.ticket] : []),
        done: p.done || [],
        slackId: p.slackId || '',
        origin: p.origin || '',
        lastTs: p.lastTs || '',
        wporg: p.wporg || '',
        route: p.route || ''
      }))
      state.nextId = data.nextId || 1
      if (data.sessionId) {
        state.sessionId = data.sessionId
      }
      state.sessionStartedAt = data.sessionStartedAt || null
      state.participantPool = normalisePool(data.participantPool)
      state.ticketPool = normalisePool(data.ticketPool)

      if (data.timerRunning && data.startTimestamp) {
        state.elapsedAtStart = data.elapsedAtStart || 0
        state.startTimestamp = data.startTimestamp
        state.timerRunning = true
        state.timerInterval = setInterval(tickTimer, 1000)
        qs('#tf-timer-btn').textContent = '⏸ Pause'
      } else {
        state.elapsedAtStart = data.elapsedAtStart || 0
      }

      qs('#tf-participant-pool').value = serialisePool(state.participantPool)
      qs('#tf-ticket-pool').value = serialisePool(state.ticketPool)

      updateTimerDisplay()
      renderParticipantSelects()
      renderTicketSelects()
      renderTable()
      refreshThanks()
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY)
    }
  }

  function resetSession() {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Reset the session? This clears participants, tickets and the timer.\n\nAssignment history is kept.')) {
      return
    }

    clearInterval(state.timerInterval)
    state.timerRunning = false
    state.timerInterval = null
    state.startTimestamp = null
    state.elapsedAtStart = 0
    state.chimePlayed = false
    state.sessionStartedAt = null
    state.participants = []
    state.nextId = 1
    state.participantPool = []
    state.ticketPool = []
    state.sessionId = newSessionId()

    qs('#tf-timer').textContent = '00:00'
    qs('#tf-timer').classList.remove('is-warning')
    qs('#tf-timer-btn').textContent = '▶ Start'
    qs('#tf-participant-pool').value = ''
    qs('#tf-ticket-pool').value = ''

    localStorage.removeItem(STORAGE_KEY)

    renderParticipantSelects()
    renderTicketSelects()
    renderTable()
    refreshThanks()
  }

  // ── Edit elapsed time ────────────────────────────────────────

  function parseTimeInput(str) {
    str = str.trim()
    if (/^\d{1,2}:\d{2}$/.test(str)) {
      const parts = str.split(':')
      return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10)
    }
    if (/^\d+$/.test(str)) {
      return parseInt(str, 10) * 60
    }
    return null
  }

  function exitEditTimer(applyChanges) {
    const el = qs('#tf-timer')
    const btn = qs('#tf-edit-limit-btn')

    if (applyChanges) {
      const seconds = parseTimeInput(el.textContent)
      if (null !== seconds && seconds >= 0) {
        state.elapsedAtStart = seconds
      }
    }

    if (state.wasRunningBeforeEdit) {
      state.startTimestamp = Date.now()
      state.timerInterval = setInterval(tickTimer, 1000)
      state.timerRunning = true
      qs('#tf-timer-btn').textContent = '⏸ Pause'
    }

    state.wasRunningBeforeEdit = false
    qs('#tf-timer-btn').disabled = false
    updateTimerDisplay()
    saveSessionState()
    el.contentEditable = 'false'
    btn.textContent = 'Edit'
  }

  function toggleEditTimer() {
    const el = qs('#tf-timer')
    const btn = qs('#tf-edit-limit-btn')

    if ('true' === el.contentEditable) {
      exitEditTimer(true)
      return
    }

    state.wasRunningBeforeEdit = state.timerRunning

    if (state.timerRunning) {
      state.elapsedAtStart = getElapsed()
      state.startTimestamp = null
      clearInterval(state.timerInterval)
      state.timerRunning = false
    }

    qs('#tf-timer-btn').disabled = true

    el.contentEditable = 'true'
    el.focus()

    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel.removeAllRanges()
    sel.addRange(range)

    btn.textContent = 'Save'
  }


  // ── Pools ────────────────────────────────────────────────────

  // Levels ----------------------------------------------------

  const LEVELS = ['beginner', 'moderate', 'advanced']

  const LEVEL_ALIASES = {
    beginner: 'beginner', newcomer: 'beginner', novice: 'beginner',
    'first-timer': 'beginner', firsttimer: 'beginner', first: 'beginner',
    b: 'beginner', '1': 'beginner',
    moderate: 'moderate', medium: 'moderate', intermediate: 'moderate',
    mid: 'moderate', m: 'moderate', '2': 'moderate',
    advanced: 'advanced', pro: 'advanced', expert: 'advanced',
    senior: 'advanced', a: 'advanced', '3': 'advanced'
  }

  function normLevel(raw) {
    if (!raw) return ''
    return LEVEL_ALIASES[String(raw).trim().toLowerCase()] || ''
  }

  function levelRank(level) {
    return LEVELS.indexOf(level)
  }

  function levelLabel(level) {
    return level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Unset'
  }

  // Derive from keywords the project already maintains rather than guessing
  // from the summary text. has-test-info means the ticket carries written
  // instructions, which is the real predictor of whether someone can work it
  // without help from the moderator.
  function levelFromKeywords(keywords) {
    const k = String(keywords || '').toLowerCase()

    // Trac keywords.
    if (-1 !== k.indexOf('good-first-bug')) return 'beginner'
    if (-1 !== k.indexOf('has-test-info') || -1 !== k.indexOf('has-testing-info')) return 'moderate'

    // GitHub labels. Gutenberg uses a different vocabulary from Trac, and
    // without these every imported issue fell through to advanced.
    if (-1 !== k.indexOf('good first issue')) return 'beginner'
    if (-1 !== k.indexOf('needs accessibility feedback')) return 'advanced'
    if (-1 !== k.indexOf('[type] bug') && -1 !== k.indexOf('needs testing')) return 'moderate'

    // Unknown stays advanced on purpose. Handing a hard ticket to a beginner
    // costs more than holding an easy one back.
    return 'advanced'
  }

  // Pools -----------------------------------------------------
  // A pool entry is { value, level }. A line may carry an optional level
  // after a pipe, e.g. "username | pro" or "https://... | beginner".

  function parsePoolLine(line) {
    const bar = line.indexOf('|')
    if (-1 === bar) return { value: line.trim(), level: '' }
    return { value: line.slice(0, bar).trim(), level: normLevel(line.slice(bar + 1)) }
  }

  function parsePool(text) {
    return text
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
      .map(parsePoolLine)
      .filter(e => e.value)
  }

  // Accepts the old shape (array of plain strings) so sessions saved by an
  // earlier version keep working after an upgrade.
  function normalisePool(raw) {
    return (raw || [])
      .map(e => 'string' === typeof e
        ? { value: e, level: '' }
        : { value: (e && e.value) || '', level: normLevel(e && e.level), meta: (e && e.meta) || null })
      .filter(e => e.value)
  }

  function poolValues(pool) {
    return pool.map(e => e.value)
  }

  function poolLevel(pool, value) {
    const found = pool.find(e => e.value === value)
    return found ? found.level : ''
  }

  function setPoolLevel(pool, value, level) {
    const found = pool.find(e => e.value === value)
    if (found) {
      found.level = normLevel(level)
    }
  }

  function serialisePool(pool) {
    return pool.map(e => e.level ? e.value + ' | ' + e.level : e.value).join('\n')
  }

  // Trac CSV import -------------------------------------------
  // core.trac.wordpress.org returns 403 to server side clients on ticket HTML,
  // CSV and RSS alike, so the plugin cannot fetch a query itself. It can hand
  // you the exact query URL though. You are a logged in human in a browser,
  // which is the one thing Trac will answer.

  const TRAC_QUERY_BASE = 'https://core.trac.wordpress.org/query?'
  const TRAC_OPEN_STATUS = 'status=accepted&status=assigned&status=new&status=reopened&status=reviewing'
  const TRAC_COLUMNS = 'col=id&col=summary&col=status&col=keywords&col=milestone&col=priority&col=type&col=component&col=owner&col=time&col=changetime'

  const CSV_PRESETS = [
    {
      key: 'scrub',
      label: 'Needs testing, with a patch',
      note: 'The usual scrub pool.',
      query: 'keywords=~needs-testing+has-patch'
    },
    {
      key: 'firstbug',
      label: 'Good first bugs',
      note: 'Safest handovers for someone new.',
      query: 'keywords=~good-first-bug'
    },
    {
      key: 'testinfo',
      label: 'Test steps already written on the ticket',
      note: 'has-test-info, so you write nothing.',
      query: 'keywords=~has-test-info'
    }
  ]

  function tracQueryUrl(query, asCsv) {
    return TRAC_QUERY_BASE + TRAC_OPEN_STATUS + '&' + query + '&' + TRAC_COLUMNS
      + '&max=0&order=priority' + (asCsv ? '&format=csv' : '')
  }

  // Straight from the documented kill criteria. A ticket waiting on a design
  // or a maintainer decision cannot be unblocked by testing it, so handing it
  // to a volunteer wastes their hour.
  const BLOCKING_KEYWORDS = [
    'needs-design', 'changes-requested', '2nd-opinion', 'dev-feedback',
    'reporter-feedback', 'needs-refresh', 'needs-privacy-review', 'needs-copy-review'
  ]

  const HEADING_FOR_COMMIT = ['commit', 'close']

  const CLOSED_STATUSES = [
    'closed', 'fixed', 'duplicate', 'worksforme', 'invalid', 'wontfix', 'maybelater'
  ]

  function keywordList(raw) {
    return String(raw || '').toLowerCase().split(/[\s,]+/).filter(Boolean)
  }

  function scrubReadiness(row) {
    const kw = keywordList(row.keywords)
    const status = String(row.status || '').trim().toLowerCase()

    if (status && -1 !== CLOSED_STATUSES.indexOf(status)) {
      return { ready: false, reason: 'status is ' + status }
    }

    const blocked = BLOCKING_KEYWORDS.filter(k => -1 !== kw.indexOf(k))
    if (blocked.length) {
      return { ready: false, reason: 'waiting on a decision (' + blocked.join(', ') + ')' }
    }

    const shipping = HEADING_FOR_COMMIT.filter(k => -1 !== kw.indexOf(k))
    if (shipping.length) {
      return { ready: false, reason: 'already heading for commit (' + shipping.join(', ') + ')' }
    }

    if (kw.length && -1 === kw.indexOf('has-patch') && -1 === kw.indexOf('has-test-info')) {
      return { ready: false, reason: 'no patch and no written test steps' }
    }

    return { ready: true, reason: '' }
  }

  function parseCsv(text) {
    const rows = []
    let row = []
    let field = ''
    let inQuotes = false

    for (let i = 0; i < text.length; i++) {
      const c = text.charAt(i)

      if (inQuotes) {
        if ('"' === c) {
          if ('"' === text.charAt(i + 1)) {
            field += '"'
            i++
          } else {
            inQuotes = false
          }
        } else {
          field += c
        }
        continue
      }

      if ('"' === c) {
        inQuotes = true
      } else if (',' === c) {
        row.push(field)
        field = ''
      } else if ('\n' === c) {
        row.push(field)
        rows.push(row)
        row = []
        field = ''
      } else if ('\r' !== c) {
        field += c
      }
    }

    if (field.length || row.length) {
      row.push(field)
      rows.push(row)
    }

    return rows.filter(r => r.some(v => '' !== v.trim()))
  }

  // Processed in chunks so the progress bar actually moves and a large export
  // does not lock the tab.
  function importTracCsv(text, options, onProgress) {
    return new Promise((resolve) => {
      const rows = parseCsv(text)

      if (rows.length < 2) {
        resolve({ error: 'No rows found. Download the CSV from Trac and paste the whole file, header row included.' })
        return
      }

      const header = rows[0].map(h => h.replace(/^\ufeff/, '').trim().toLowerCase())
      const idIdx = header.indexOf('id')

      if (-1 === idIdx) {
        resolve({ error: 'No "id" column in the header row. Use one of the query links above, they include it.' })
        return
      }

      const col = name => header.indexOf(name)
      const idx = {
        time: col('time'),
        changetime: col('changetime'),
        summary: col('summary'),
        status: col('status'),
        keywords: col('keywords'),
        milestone: col('milestone'),
        priority: col('priority'),
        type: col('type'),
        component: col('component'),
        owner: col('owner')
      }

      const known = new Set(poolValues(state.ticketPool))
      const accepted = []
      const omitted = []
      const total = rows.length - 1
      const onlyReady = !!(options && options.onlyReady)
      let i = 1

      const cell = (r, k) => -1 === idx[k] ? '' : String(r[idx[k]] || '').trim()

      const step = () => {
        const end = Math.min(i + 50, rows.length)

        for (; i < end; i++) {
          const r = rows[i]
          const raw = String(r[idIdx] || '').trim().replace(/^#/, '')

          if (!/^[0-9]+$/.test(raw)) {
            omitted.push({ id: raw || '(blank)', reason: 'not a ticket number' })
            continue
          }

          const url = 'https://core.trac.wordpress.org/ticket/' + raw

          if (known.has(url)) {
            omitted.push({ id: '#' + raw, reason: 'already in the pool' })
            continue
          }

          const meta = {
            time: cell(r, 'time'),
            changetime: cell(r, 'changetime'),
            summary: cell(r, 'summary'),
            status: cell(r, 'status'),
            keywords: cell(r, 'keywords'),
            milestone: cell(r, 'milestone'),
            priority: cell(r, 'priority'),
            type: cell(r, 'type'),
            component: cell(r, 'component'),
            owner: cell(r, 'owner')
          }

          const verdict = scrubReadiness(meta)

          if (onlyReady && !verdict.ready) {
            omitted.push({ id: '#' + raw, reason: verdict.reason })
            continue
          }

          known.add(url)
          accepted.push({
            value: url,
            level: -1 === idx.keywords ? '' : levelFromKeywords(meta.keywords),
            meta
          })
        }

        if (onProgress) {
          onProgress(Math.min(i - 1, total), total)
        }

        if (i < rows.length) {
          window.requestAnimationFrame(step)
        } else {
          resolve({
            accepted,
            omitted,
            total,
            noKeywords: -1 === idx.keywords,
            error: ''
          })
        }
      }

      step()
    })
  }

  // Manual ticket entry ---------------------------------------
  // Accepts whatever a moderator has to hand: bare numbers, #numbers, full
  // Trac URLs, GitHub issue links, separated by commas, spaces or new lines,
  // with an optional level after a pipe.

  function parseManualTickets(text) {
    const added = []
    const rejected = []

    String(text || '')
      .split(/[\n,;]+/)
      .map(chunk => chunk.trim())
      .filter(Boolean)
      .forEach(chunk => {
        const bar = chunk.indexOf('|')
        const raw = (-1 === bar ? chunk : chunk.slice(0, bar)).trim()
        const level = -1 === bar ? '' : normLevel(chunk.slice(bar + 1))

        if (/^https?:\/\//i.test(raw)) {
          added.push({ value: raw, level })
          return
        }

        const digits = raw.replace(/^#/, '')

        if (/^[0-9]{2,7}$/.test(digits)) {
          added.push({ value: 'https://core.trac.wordpress.org/ticket/' + digits, level })
          return
        }

        rejected.push(raw)
      })

    return { added, rejected }
  }

  function addManualTickets(text) {
    const parsed = parseManualTickets(text)
    const known = new Set(poolValues(state.ticketPool))
    let added = 0
    let duplicate = 0

    parsed.added.forEach(entry => {
      if (known.has(entry.value)) {
        // Already in the pool. If a level was given, take it, since the
        // moderator is telling us something they know.
        if (entry.level) {
          setPoolLevel(state.ticketPool, entry.value, entry.level)
        }
        duplicate++
        return
      }

      known.add(entry.value)
      state.ticketPool.push({ value: entry.value, level: entry.level })
      added++
    })

    if (added || duplicate) {
      qs('#tf-ticket-pool').value = serialisePool(state.ticketPool)
      renderTicketSelects()
      saveSessionState()
    }

    const bits = []
    if (added) bits.push(added + ' added')
    if (duplicate) bits.push(duplicate + ' already in the pool')
    if (parsed.rejected.length) bits.push(parsed.rejected.length + ' not recognised: ' + parsed.rejected.slice(0, 5).join(', '))

    const unlevelled = parsed.added.filter(e => !e.level).length
    if (added && unlevelled) {
      bits.push(unlevelled + ' with no level, set one or import the CSV')
    }

    return bits.length ? bits.join(', ') + '.' : 'Nothing to add.'
  }

  function renderPresets() {
    const host = qs('#tf-csv-presets')
    if (!host) {
      return
    }

    host.innerHTML = ''

    CSV_PRESETS.forEach(p => {
      const li = cel('li')

      const open = cel('a')
      open.href = tracQueryUrl(p.query, false)
      open.target = '_blank'
      open.rel = 'noopener noreferrer'
      open.textContent = p.label
      li.appendChild(open)

      li.appendChild(document.createTextNode('  '))

      const dl = cel('a')
      dl.href = tracQueryUrl(p.query, true)
      dl.target = '_blank'
      dl.rel = 'noopener noreferrer'
      dl.className = 'tf-csv-download'
      dl.textContent = 'download CSV'
      li.appendChild(dl)

      const note = cel('span')
      note.className = 'tf-csv-note'
      note.textContent = p.note
      li.appendChild(note)

      host.appendChild(li)
    })
  }

  function renderImportReport(result) {
    const host = qs('#tf-import-report')
    if (!host) {
      return
    }

    host.innerHTML = ''

    if (!result || result.error) {
      return
    }

    if (result.accepted.length) {
      const label = cel('p')
      label.className = 'tf-import-subhead'
      label.textContent = 'Added ' + result.accepted.length + ' of ' + result.total + '.'
      host.appendChild(label)

      const table = cel('table')
      table.className = 'widefat tf-import-table'

      const thead = cel('thead')
      const hr = cel('tr')
      ;['Ticket', 'Level', 'Summary', 'Milestone', 'Priority'].forEach(h => {
        const th = cel('th')
        th.textContent = h
        hr.appendChild(th)
      })
      thead.appendChild(hr)
      table.appendChild(thead)

      const tbody = cel('tbody')
      result.accepted.slice(0, 40).forEach(t => {
        const tr = cel('tr')

        const tdId = cel('td')
        const a = cel('a')
        a.href = t.value
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = ticketLabel(t.value)
        tdId.appendChild(a)
        tr.appendChild(tdId)

        const tdLevel = cel('td')
        tdLevel.textContent = levelLabel(t.level)
        tr.appendChild(tdLevel)

        const tdSum = cel('td')
        tdSum.className = 'tf-cell-summary'
        tdSum.textContent = t.meta.summary || ''
        tdSum.title = t.meta.summary || ''
        tr.appendChild(tdSum)

        const tdMs = cel('td')
        tdMs.textContent = t.meta.milestone || ''
        tr.appendChild(tdMs)

        const tdPr = cel('td')
        tdPr.textContent = t.meta.priority || ''
        tr.appendChild(tdPr)

        tbody.appendChild(tr)
      })
      table.appendChild(tbody)
      host.appendChild(table)

      if (result.accepted.length > 40) {
        const more = cel('p')
        more.className = 'tf-import-note'
        more.textContent = 'Showing the first 40. All ' + result.accepted.length + ' are in the pool.'
        host.appendChild(more)
      }
    }

    if (result.omitted.length) {
      const details = cel('details')
      details.className = 'tf-omitted'

      const summary = cel('summary')
      summary.className = 'tf-import-summary'
      summary.textContent = 'Left out: ' + result.omitted.length + '. Reasons listed.'
      details.appendChild(summary)

      const grouped = {}
      result.omitted.forEach(o => {
        if (!grouped[o.reason]) {
          grouped[o.reason] = []
        }
        grouped[o.reason].push(o.id)
      })

      Object.keys(grouped).sort().forEach(reason => {
        const p = cel('p')
        p.className = 'tf-omitted-row'

        const strong = cel('strong')
        strong.textContent = grouped[reason].length + ' ' + reason + ': '
        p.appendChild(strong)

        p.appendChild(document.createTextNode(grouped[reason].slice(0, 30).join(', ')
          + (grouped[reason].length > 30 ? ' and more' : '')))

        details.appendChild(p)
      })

      host.appendChild(details)
    }
  }

  function ticketLabel(url) {
    try {
      const parts = new URL(url).pathname.split('/').filter(Boolean)
      return '#' + parts[parts.length - 1]
    } catch (e) {
      return url.length > 40 ? url.slice(0, 40) + '…' : url
    }
  }

  // Trac tickets read as #ID in chat; everything else (e.g. GitHub PRs) keeps the full link.
  function ticketRef(url) {
    try {
      const u = new URL(url)
      if (/trac\.wordpress\.org$/.test(u.hostname)) {
        const parts = u.pathname.split('/').filter(Boolean)
        const id = parts[parts.length - 1]
        if (id && /^\d+$/.test(id)) {
          return '#' + id
        }
      }
    } catch (e) {}
    return url
  }

  function renderParticipantSelects() {
    const el = qs('#tf-participant-select')
    if (!el) {
      return
    }

    const placeholder = el.querySelector('option[value=""]')
    const label = placeholder ? placeholder.textContent : '\u2014'

    el.innerHTML = ''
    el.appendChild(new Option(label, ''))
    poolValues(state.participantPool).forEach(name => {
      el.appendChild(new Option('@' + name, name))
    })
  }

  function getAvailableTickets() {
    const used = new Set(state.participants.flatMap(p => p.tickets))
    return poolValues(state.ticketPool).filter(url => !used.has(url))
  }

  // Level only. Used for tickets already assigned, where the history note
  // would be noise.
  function ticketDisplayLabel(url) {
    const lv = poolLevel(state.ticketPool, url)
    const src = ticketSource(url)
    const base = 'Core' === src ? ticketLabel(url) : ticketLabel(url) + ' ' + src

    return lv ? base + '  (' + levelLabel(lv) + ')' : base
  }

  // Level plus history. Used in the assign dropdown, where it is the point.
  function ticketOptionLabel(url, username) {
    let label = ticketDisplayLabel(url)

    if (username && hasTested(username, url)) {
      label += '  - they had this before'
    } else {
      const others = priorTesters(url, username)
      if (others.length) {
        label += '  - ' + others.length + ' had this before'
      }
    }

    return label
  }

  // Matching level first, then unlevelled, then the nearest level. Anything
  // this person already had drops to the bottom. Nothing is hidden, so the
  // moderator can always override.
  function sortTicketsFor(urls, pLevel, pName) {
    const score = url => {
      const tl = poolLevel(state.ticketPool, url)
      let s

      if (!pLevel) s = tl ? 0 : 1
      else if (tl === pLevel) s = 0
      else if (!tl) s = 1
      else s = 2 + Math.abs(levelRank(tl) - levelRank(pLevel))

      if (pName && hasTested(pName, url)) s += 10

      return s
    }

    return urls.slice().sort((a, b) => score(a) - score(b))
  }

  function fillTicketSelect(el) {
    const pid = parseInt(el.dataset.pid, 10)
    const p = state.participants.find(x => x.id === pid)
    const pLevel = p ? p.level : ''
    const pName = p ? p.username : ''
    const current = el.value

    el.innerHTML = ''
    el.appendChild(new Option('\u2014 ticket / issue \u2014', ''))

    sortTicketsFor(getAvailableTickets(), pLevel, pName).forEach(url => {
      const opt = new Option(ticketOptionLabel(url, pName), url)
      const tl = poolLevel(state.ticketPool, url)
      const classes = []

      if (pLevel && tl && tl !== pLevel) {
        classes.push('tf-opt-offlevel')
      }
      if (pName && hasTested(pName, url)) {
        classes.push('tf-opt-repeat')
      }
      if (classes.length) {
        opt.className = classes.join(' ')
      }

      el.appendChild(opt)
    })

    if (current) {
      el.value = current
    }
  }

  function renderTicketSelects() {
    qsa('.tf-inline-ticket-select').forEach(fillTicketSelect)
    renderPoolBreakdown()
  }

  // A scrub can hold core Trac tickets and Gutenberg issues at the same time,
  // and they are tested differently. Saying so above the table is cheaper than
  // making the moderator read every URL.
  function renderPoolBreakdown() {
    const el = qs('#tf-pool-breakdown')

    if (!el) {
      return
    }

    const counts = sourceBreakdown()
    const names = Object.keys(counts).sort()

    if (!names.length) {
      el.textContent = ''
      return
    }

    const total = names.reduce((sum, n) => sum + counts[n], 0)

    el.textContent = total + ' in the pool: '
      + names.map(n => counts[n] + ' ' + n).join(', ')
  }

  function setParticipantLevel(id, level) {
    const p = state.participants.find(x => x.id === id)
    if (!p) {
      return
    }

    p.level = normLevel(level)
    setPoolLevel(state.participantPool, p.username, p.level)

    const pool = qs('#tf-participant-pool')
    if (pool) {
      pool.value = serialisePool(state.participantPool)
    }

    renderTicketSelects()
    saveSessionState()
  }

  // Clipboard -------------------------------------------------

  function updateClipboardBar(text) {
    const el = qs('#tf-clipboard-text')
    if (el) {
      el.textContent = text
      el.classList.remove('tf-clipboard-text--empty')
    }
  }

  function copyText(text, btn) {
    const onSuccess = () => {
      toast('Copied to clipboard')
      updateClipboardBar(text)
      if (btn) {
        flashCopied(btn)
      }
    }

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(onSuccess)
      return
    }

    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    onSuccess()
  }

  function flashCopied(btn) {
    btn.classList.add('is-copied')
    setTimeout(() => btn.classList.remove('is-copied'), 1500)
  }

  function toast(msg) {
    const el = qs('#tf-toast')
    el.textContent = msg
    el.classList.add('is-visible')
    clearTimeout(el._tfTimer)
    el._tfTimer = setTimeout(() => el.classList.remove('is-visible'), 2200)
  }

  // ── Participants ─────────────────────────────────────────────

  function addParticipant(username) {
    if (!username) {
      toast('Select a participant')
      return
    }

    if (state.participants.find(p => p.username === username)) {
      toast('@' + username + ' is already in the list')
      return
    }

    state.participants.push({
      id: state.nextId++,
      username,
      level: poolLevel(state.participantPool, username),
      tickets: [],
      done: []
    })

    renderTable()
    refreshThanks()
    saveSessionState()
  }

  function assignTicket(id, url) {
    if (!url) {
      toast('Select a ticket')
      return
    }

    const p = state.participants.find(p => p.id === id)
    if (!p) {
      return
    }

    if (hasTested(p.username, url)) {
      // eslint-disable-next-line no-alert
      if (!window.confirm('@' + p.username + ' was already assigned ' + ticketLabel(url)
        + ' in an earlier session.\n\nAssign it again?')) {
        return
      }
    }

    p.tickets.push(url)
    recordAssignment(p.username, url)

    const handled = p.tickets.length + ((p.done && p.done.length) || 0)
    const tmplKey = 1 === handled ? 'first_assign' : 'followup'
    const msg = applyTemplate( getMsgByKey( 'assignment', tmplKey ), { username: p.username, url: ticketRef( url ) } )

    if (state.slack.autoSend && state.webhook && (state.webhook.configured || state.webhook.token_configured)) {
      sendForParticipant(p, msg)
      updateClipboardBar(msg)
    } else {
      copyText(msg)
    }

    renderTable()
    saveSessionState()
  }

  // Done / Tested ---------------------------------------------

  // Marks the newest matching history entry complete. If the assignment came
  // from an earlier session and is being closed now, record it rather than
  // silently dropping it.
  function markHistoryDone(username, url) {
    let target = null

    for (let i = state.history.entries.length - 1; i >= 0; i--) {
      const e = state.history.entries[i]
      if (e.username === username && e.url === url && 'done' !== e.status) {
        target = e
        break
      }
    }

    if (!target) {
      target = { username, url, ts: Date.now(), session: state.sessionId }
      state.history.entries.push(target)
    }

    target.status = 'done'
    target.doneTs = Date.now()
    saveHistory()
    renderHistory()
  }

  // Reads the acknowledgement out of the message config and fills the
  // placeholder in. The config ships [USERNAME], which the template engine
  // does not substitute, so it is repaired here at the point of use.
  function ackMessage(username) {
    const items = getSectionItems('monitoring')
    const found = items.find(i =>
      i.text && -1 !== i.text.indexOf('[USERNAME]') && -1 === i.text.indexOf('[TICKET_URL]'))
    const tmpl = found ? found.text : 'Great work @[USERNAME], thanks for the report!'
    return tmpl.split('[USERNAME]').join(username)
  }

  function markTicketDone(id, url) {
    const p = state.participants.find(x => x.id === id)
    if (!p) {
      return
    }

    p.tickets = p.tickets.filter(t => t !== url)
    if (!p.done) {
      p.done = []
    }
    if (-1 === p.done.indexOf(url)) {
      p.done.push(url)
    }

    markHistoryDone(p.username, url)

    const ack = ackMessage(p.username)

    if (state.slack.autoSend && state.webhook && (state.webhook.configured || state.webhook.token_configured)) {
      sendForParticipant(p, ack)
      updateClipboardBar(ack)
    } else {
      copyText(ack)
    }
    renderTable()
    saveSessionState()
    toast(ticketLabel(url) + ' marked done. Acknowledgement copied.')
  }

  function removeTicketFromParticipant(id, url) {
    const p = state.participants.find(p => p.id === id)
    if (!p) {
      return
    }
    p.tickets = p.tickets.filter(t => t !== url)
    unrecordAssignment(p.username, url)
    renderTable()
    saveSessionState()
  }

  // ── Render table ─────────────────────────────────────────────

  function renderTable() {
    const tbody = qs('#tf-participants-list')
    tbody.innerHTML = ''

    if (0 === state.participants.length) {
      const tr = document.createElement('tr')
      tr.className = 'tf-empty-row'
      tr.innerHTML = '<td colspan="5">No participants yet. Add someone above to get started.</td>'
      tbody.appendChild(tr)
      return
    }

    state.participants.forEach(p => tbody.appendChild(buildRow(p)))
    renderTicketSelects()
    refreshProps()
  }

  function buildLevelSelect(p) {
    const sel = cel('select')
    sel.className = 'tf-level-select'
    sel.setAttribute('aria-label', 'Testing level for ' + p.username)

    sel.appendChild(new Option(levelLabel(''), ''))
    LEVELS.forEach(l => sel.appendChild(new Option(levelLabel(l), l)))

    sel.value = p.level || ''
    sel.addEventListener('change', () => setParticipantLevel(p.id, sel.value))

    return sel
  }

  function buildRow(p) {
    const tr = document.createElement('tr')

    const tdUser = cel('td')
    const userLink = cel('a')
    userLink.href = p.wporg || wporgUrl(p.username)
    userLink.target = '_blank'
    userLink.rel = 'noopener noreferrer'
    userLink.textContent = '@' + p.username
    // The cell ellipsises long handles, so carry the full one in the tooltip.
    userLink.title = '@' + p.username + ' - open their wordpress.org profile'
    tdUser.appendChild(userLink)
    tr.appendChild(tdUser)

    const tdLevel = cel('td')
    tdLevel.appendChild(buildLevelSelect(p))
    tr.appendChild(tdLevel)

    const tdTickets = cel('td')
    tdTickets.className = 'tf-assigned-cell'
    const doneCount = (p.done && p.done.length) || 0

    if (p.tickets.length > 0) {
      p.tickets.forEach((url, i) => {
        if (i > 0) {
          tdTickets.appendChild(document.createTextNode(' '))
        }

        const item = cel('span')
        item.className = 'tf-ticket-item'

        const a = cel('a')
        a.className = 'tf-ticket-link'
        a.href = url
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = ticketDisplayLabel(url)
        item.appendChild(a)

        const doneBtn = cel('button')
        doneBtn.className = 'tf-ticket-done-btn'
        doneBtn.title = 'They reported on this. Clear it and copy the acknowledgement.'
        doneBtn.textContent = 'Done'
        doneBtn.addEventListener('click', () => markTicketDone(p.id, url))
        item.appendChild(doneBtn)

        const removeBtn = cel('button')
        removeBtn.className = 'tf-ticket-remove-btn'
        removeBtn.title = 'Assigned by mistake. Remove it and forget it.'
        removeBtn.textContent = '\u00d7'
        removeBtn.addEventListener('click', () => removeTicketFromParticipant(p.id, url))
        item.appendChild(removeBtn)

        tdTickets.appendChild(item)
      })
    } else {
      const idle = cel('span')
      idle.className = 'tf-ticket-idle tf-assigned-idle'
      idle.textContent = doneCount ? 'ready for another' : '\u2014'
      tdTickets.appendChild(idle)
    }

    if (doneCount) {
      const chip = cel('span')
      chip.className = 'tf-done-chip'
      chip.title = 'Completed this session. The tickets themselves are in the history panel.'
      chip.textContent = doneCount + ' done'
      tdTickets.appendChild(chip)
    }

    tr.appendChild(tdTickets)

    const tdRoute = cel('td')
    tdRoute.appendChild(buildRouteSelect(p))
    tr.appendChild(tdRoute)

    const tdActions = cel('td')
    tdActions.appendChild(buildActions(p))
    tr.appendChild(tdActions)

    return tr
  }

  // Each person carries their own route, seeded from where they were found.
  // The little origin note matters: it is the reason the default is what it is.
  function buildRouteSelect(p) {
    const wrap = cel('div')

    const sel = cel('select')
    sel.className = 'tf-route-select'
    sel.setAttribute('aria-label', 'Where replies to ' + p.username + ' go')

    ROUTES.forEach(r => sel.appendChild(new Option(r.label, r.key)))

    sel.value = routeFor(p)
    sel.addEventListener('change', () => {
      p.route = sel.value
      saveSessionState()
      renderTable()
    })

    wrap.appendChild(sel)

    const note = cel('span')
    note.className = 'tf-route-origin'
    note.textContent = p.origin
      ? ('both' === p.origin ? 'seen in thread and channel' : 'came from the ' + p.origin)
      : 'added by hand'
    wrap.appendChild(note)

    return wrap
  }

  function buildActions(p) {
    const wrap = cel('div')
    wrap.className = 'tf-row-actions'

    const select = cel('select')
    select.className = 'tf-inline-ticket-select'
    select.dataset.pid = String(p.id)
    fillTicketSelect(select)

    // Trac refuses machine requests, so the plugin cannot check whether this
    // person already commented on this ticket. What it can do is put the
    // moderator one keystroke away from checking: open the ticket, and put the
    // handle on the clipboard ready for a find on the page.
    const check = cel('button')
    check.className = 'button button-small'
    check.textContent = 'Check'
    check.title = 'Open the ticket and copy this handle, then use find on the page'
    check.addEventListener('click', () => {
      if (!select.value) {
        toast('Pick a ticket first')
        return
      }

      const handle = String(p.username || '').replace(/^@/, '')

      // copyText fires its own generic toast from a promise, which would land
      // after this one and bury the useful instruction. Write directly instead.
      if (navigator.clipboard) {
        navigator.clipboard.writeText(handle).catch(() => {})
      }

      updateClipboardBar(handle)

      const win = window.open(select.value, 'tfconsole-ticket')
      if (win) {
        win.focus()
      }

      toast('Opened ' + ticketLabel(select.value) + '. "' + handle + '" copied, press Ctrl F and paste.')
    })

    const btn = cel('button')
    btn.className = 'button button-small button-primary'
    btn.textContent = 'Assign'
    btn.disabled = 0 === getAvailableTickets().length
    btn.addEventListener('click', () => assignTicket(p.id, select.value))

    wrap.append(select, check, btn)

    return wrap
  }

  // Thanks message --------------------------------------------

  function refreshThanks() {
    const names = state.participants.map(p => `@${p.username}`)
    const thanksTmpl = getMsgByPlaceholder( 'closing', 'participants' )
    const text = applyTemplate( thanksTmpl, { participants: formatParticipants( names ) } )
    const el = qs('#tf-thanks-preview')
    el.textContent = text
    el.dataset.msg = text
    el.classList.toggle('tf-preview--muted', 0 === names.length)
  }

  // ── DOM helpers ──────────────────────────────────────────────

  function qs(sel) {
    return document.querySelector(sel)
  }
  function qsa(sel) {
    return document.querySelectorAll(sel)
  }
  function cel(tag) {
    return document.createElement(tag)
  }

  // ── Init ─────────────────────────────────────────────────────

  function init() {
    state.history = loadHistory()
    state.slack = loadSlack()
    state.handles = loadHandleMap()
    state.pulled = loadPulled()
    state.sessionId = newSessionId()

    loadSessionState()
    renderHistory()

    if (state.slack.live) {
      setLive(true)
    }

    if (state.pulled && state.pulled.length) {
      renderThreadPeople(state.pulled)
      threadStatus(state.pulled.length + ' people from the last pull. Press the button to refresh.')
    }

    const urlField = qs('#tf-slack-url')
    if (urlField) {
      urlField.value = state.slack.url
      urlField.addEventListener('input', function () {
        const parsed = parseSlackUrl(this.value)
        state.slack.url = this.value
        state.slack.team = parsed.team
        state.slack.channel = parsed.channel
        saveSlack()
        refreshSlackUi()
      })
    }

    const targetSelect = qs('#tf-send-target')
    if (targetSelect) {
      targetSelect.value = state.slack.target || 'channel'
      targetSelect.addEventListener('change', function () {
        state.slack.target = this.value
        saveSlack()
        refreshSlackUi()
      })
    }

    const threadField = qs('#tf-slack-thread')
    if (threadField) {
      threadField.value = state.slack.thread
      threadField.addEventListener('input', function () {
        state.slack.thread = this.value
        saveSlack()
        renderThreadPicker()
        refreshSlackUi()
      })

      // The textarea stays as the stored value. The manager sits on top of it
      // and writes back through the same input event, so everything below here
      // carries on reading exactly what it read before.
      if (window.tfThreads) {
        window.tfThreads.attach(threadField)
      }
    }

    const threadPicker = qs('#tf-thread-picker')
    if (threadPicker) {
      threadPicker.addEventListener('change', function () {
        state.slack.active = parseInt(this.value, 10) || 0
        saveSlack()
        refreshSlackUi()
      })
    }

    const pullSource = qs('#tf-pull-source')
    if (pullSource) {
      pullSource.value = state.slack.pullFrom || 'thread'
      pullSource.addEventListener('change', function () {
        state.slack.pullFrom = this.value
        saveSlack()
      })
    }

    const liveBox = qs('#tf-pull-live')
    if (liveBox) {
      liveBox.checked = !!state.slack.live
      liveBox.addEventListener('change', function () {
        setLive(this.checked)
      })
    }

    renderThreadPicker()

    const slackOpen = qs('#tf-slack-open')
    if (slackOpen) slackOpen.addEventListener('click', openSlack)

    const slackBar = qs('#tf-clipboard-slack-btn')
    if (slackBar) slackBar.addEventListener('click', openSlack)

    const sendBar = qs('#tf-clipboard-send-btn')
    if (sendBar) {
      sendBar.addEventListener('click', () => {
        const el = qs('#tf-clipboard-text')
        if (!el || el.classList.contains('tf-clipboard-text--empty')) {
          toast('Copy a message first')
          return
        }
        sendToSlack(el.textContent)
      })
    }

    const webhookSave = qs('#tf-webhook-save')
    if (webhookSave) {
      webhookSave.addEventListener('click', () => {
        const field = qs('#tf-slack-webhook')
        const value = field ? field.value.trim() : ''

        if (!value) {
          webhookStatus('Paste the webhook URL first.')
          return
        }

        webhookStatus('Saving...')
        api('/webhook', { method: 'POST', body: JSON.stringify({ url: value }) })
          .then(s => {
            field.value = ''
            refreshWebhookUi(s)
            toast('Webhook saved')
          })
          .catch(e => webhookStatus('Not saved. ' + e.message))
      })
    }

    const webhookClear = qs('#tf-webhook-clear')
    if (webhookClear) {
      webhookClear.addEventListener('click', () => {
        // eslint-disable-next-line no-alert
        if (!window.confirm('Remove the stored Slack webhook?')) {
          return
        }
        api('/webhook', { method: 'DELETE' })
          .then(s => {
            refreshWebhookUi(s)
            toast('Webhook removed')
          })
          .catch(e => webhookStatus('Not removed. ' + e.message))
      })
    }

    loadWebhookStatus()

    refreshSlackUi()

    qs('#tf-timer-btn').addEventListener('click', toggleTimer)

    qs('#tf-timer-reset').addEventListener('click', () => {
      // eslint-disable-next-line no-alert
      if (window.confirm('Reset the session timer?')) {
        resetTimer()
      }
    })

    qs('#tf-edit-limit-btn').addEventListener('click', toggleEditTimer)

    qs('#tf-timer').addEventListener('keydown', e => {
      if ('Enter' === e.key) {
        e.preventDefault()
        exitEditTimer(true)
      }
      if ('Escape' === e.key) {
        exitEditTimer(false)
      }
    })

    qs('#tf-timer').addEventListener('keypress', e => {
      if (!/^[\d:]$/.test(e.key)) {
        e.preventDefault()
      }
    })



    const syncParticipants = value => {
      const newPool = parsePool(value)
      const names = newPool.map(e => e.value)

      newPool.forEach(entry => {
        const existing = state.participants.find(p => p.username === entry.value)
        if (existing) {
          if (entry.level) {
            existing.level = entry.level
          }
        } else {
          state.participants.push({
            id: state.nextId++,
            username: entry.value,
            level: entry.level,
            tickets: [],
            done: []
          })
        }
      })

      state.participants = state.participants.filter(p => names.includes(p.username))

      state.participantPool = newPool
      renderParticipantSelects()
      renderTable()
      refreshThanks()
      saveSessionState()
    }

    const participantPoolEl = qs('#tf-participant-pool')
    participantPoolEl.addEventListener('blur', function () {
      syncParticipants(this.value)
    })
    participantPoolEl.addEventListener('keyup', e => {
      if ('Enter' === e.key) {
        syncParticipants(participantPoolEl.value)
      }
    })

    qs('#tf-ticket-pool').addEventListener('input', function () {
      const previous = {}
      state.ticketPool.forEach(e => {
        if (e.meta) {
          previous[e.value] = e.meta
        }
      })

      state.ticketPool = parsePool(this.value).map(e => {
        if (previous[e.value]) {
          e.meta = previous[e.value]
        }
        return e
      })

      renderTicketSelects()
      saveSessionState()
    })

    renderPresets()

    const importStatus = msg => {
      const el = qs('#tf-import-status')
      if (el) {
        el.textContent = msg
      }
    }

    const showProgress = (done, total) => {
      const wrap = qs('#tf-progress-wrap')
      const bar = qs('#tf-import-progress')
      const label = qs('#tf-progress-label')

      if (!wrap || !bar) {
        return
      }

      wrap.hidden = false
      bar.max = total || 1
      bar.value = done

      if (label) {
        label.textContent = done + ' of ' + total + ' rows read'
      }
    }

    const applyImport = text => {
      if (!text || !text.trim()) {
        importStatus('Nothing to import.')
        return
      }

      const onlyReady = (() => {
        const cb = qs('#tf-import-only-ready')
        return cb ? cb.checked : true
      })()

      importStatus('Reading...')
      renderImportReport(null)

      importTracCsv(text, { onlyReady }, showProgress).then(result => {
        const wrap = qs('#tf-progress-wrap')

        if (result.error) {
          if (wrap) wrap.hidden = true
          importStatus(result.error)
          return
        }

        result.accepted.forEach(t => state.ticketPool.push(t))

        qs('#tf-ticket-pool').value = serialisePool(state.ticketPool)
        renderTicketSelects()
        saveSessionState()
        renderImportReport(result)

        const parts = [
          result.accepted.length + ' added',
          result.omitted.length + ' left out',
          'of ' + result.total + ' rows'
        ]

        if (result.noKeywords) {
          parts.push('no keywords column, so no levels were set')
        }

        importStatus(parts.join(', ') + '.')
        toast(result.accepted.length + ' tickets imported')

        if (wrap) {
          window.setTimeout(() => { wrap.hidden = true }, 1500)
        }
      })
    }

    const histExport = qs('#tf-history-export')
    if (histExport) {
      histExport.addEventListener('click', () => {
        if (!state.history.entries.length) {
          toast('Nothing to export')
          return
        }

        const blob = new Blob([historyToCsv()], { type: 'text/csv;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')

        a.href = url
        a.download = 'testflow-assignment-history.csv'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      })
    }

    const histClear = qs('#tf-history-clear')
    if (histClear) {
      histClear.addEventListener('click', () => {
        if (!state.history.entries.length) {
          toast('History is already empty')
          return
        }

        // eslint-disable-next-line no-alert
        if (!window.confirm('Delete all ' + state.history.entries.length
          + ' recorded assignments? This cannot be undone.')) {
          return
        }

        state.history = { version: 1, entries: [] }
        saveHistory()
        renderHistory()
        renderTicketSelects()
        toast('History cleared')
      })
    }

    const tokenSave = qs('#tf-token-save')
    if (tokenSave) {
      tokenSave.addEventListener('click', () => {
        const field = qs('#tf-slack-token')
        const value = field ? field.value.trim() : ''

        if (!value) {
          tokenStatus('Paste the bot token first.')
          return
        }

        tokenStatus('Saving...')
        api('/token', { method: 'POST', body: JSON.stringify({ token: value }) })
          .then(s => {
            field.value = ''
            refreshWebhookUi(s)
            refreshTokenUi()
            toast('Token saved')
          })
          .catch(e => tokenStatus('Not saved. ' + e.message))
      })
    }

    const tokenClear = qs('#tf-token-clear')
    if (tokenClear) {
      tokenClear.addEventListener('click', () => {
        // eslint-disable-next-line no-alert
        if (!window.confirm('Remove the stored Slack bot token?')) {
          return
        }

        api('/token', { method: 'DELETE' })
          .then(s => {
            refreshWebhookUi(s)
            refreshTokenUi()
            toast('Token removed')
          })
          .catch(e => tokenStatus('Not removed. ' + e.message))
      })
    }

    const threadPull = qs('#tf-thread-pull')
    if (threadPull) {
      threadPull.addEventListener('click', () => pullThread(false))
    }

    const picker = qs('#tf-announcement-picker')
    if (picker) {
      picker.addEventListener('change', function () {
        if (!this.value) {
          return
        }

        const opt = this.options[this.selectedIndex]
        const input = qs('#tf-announcement')

        if (input) {
          input.value = (opt.dataset.title || '') + ' ' + this.value
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
      })

      loadAnnouncements(false)
    }

    const announceRefresh = qs('#tf-announcement-refresh')
    if (announceRefresh) {
      announceRefresh.addEventListener('click', () => loadAnnouncements(true))
    }

    const propsCopy = qs('#tf-props-copy')
    if (propsCopy) {
      propsCopy.addEventListener('click', function () {
        const msg = qs('#tf-props-preview').dataset.msg
        if (!msg) {
          toast('Nobody to prop yet')
          return
        }
        copyText(msg, this)
      })
    }

    const propsSend = qs('#tf-props-send')
    if (propsSend) {
      propsSend.addEventListener('click', () => {
        const msg = qs('#tf-props-preview').dataset.msg

        if (!msg) {
          toast('Nobody to prop yet')
          return
        }

        const target = propsChannel()

        if (!target) {
          toast('Set a channel first')
          return
        }

        webhookStatus('Sending props...')

        api('/send', {
          method: 'POST',
          body: JSON.stringify({ text: signed(msg), channel: target, target: 'channel' })
        })
          .then(() => {
            webhookStatus('Props sent to ' + target + '.')
            toast('Props sent')
          })
          .catch(e => {
            webhookStatus('Props not sent. ' + e.message)
            toast('Props send failed')
          })
      })
    }

    const propsUrl = qs('#tf-props-url')
    if (propsUrl) {
      propsUrl.value = state.slack.propsUrl || ''
      propsUrl.addEventListener('input', function () {
        const parsed = parseSlackUrl(this.value)
        state.slack.propsUrl = this.value
        state.slack.propsChannel = parsed.channel
        saveSlack()
        refreshPropsTarget()
      })
    }

    const moderator = qs('#tf-moderator')
    if (moderator) {
      moderator.value = state.slack.moderator || ''
      moderator.addEventListener('input', function () {
        state.slack.moderator = this.value
        saveSlack()
      })
    }

    const autoSend = qs('#tf-auto-send')
    if (autoSend) {
      autoSend.checked = !!state.slack.autoSend
      autoSend.addEventListener('change', function () {
        state.slack.autoSend = this.checked
        saveSlack()
      })
    }

    refreshPropsTarget()

    refreshProps()

    const manualBtn = qs('#tf-manual-add')
    if (manualBtn) {
      manualBtn.addEventListener('click', () => {
        const field = qs('#tf-manual-tickets')
        const status = qs('#tf-manual-status')
        const result = addManualTickets(field ? field.value : '')

        if (status) {
          status.textContent = result
        }

        if (field && -1 !== result.indexOf('added')) {
          field.value = ''
        }
      })
    }

    const gbSync = qs('#tf-gb-sync')
    if (gbSync) {
      gbSync.addEventListener('click', importGutenberg)
    }

    const newSessionBtn = qs('#tf-new-session-btn')
    if (newSessionBtn) {
      newSessionBtn.addEventListener('click', newSession)
    }

    const importBtn = qs('#tf-import-csv-btn')
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        applyImport(qs('#tf-import-csv-text').value)
      })
    }

    const importFile = qs('#tf-import-csv-file')
    if (importFile) {
      importFile.addEventListener('change', function () {
        const file = this.files && this.files[0]
        if (!file) {
          return
        }
        const reader = new FileReader()
        reader.onload = () => applyImport(String(reader.result))
        reader.onerror = () => importStatus('Could not read that file.')
        reader.readAsText(file)
        this.value = ''
      })
    }

    document.addEventListener('click', e => {
      if (e.target.matches('.tf-copy-btn[data-msg]')) {
        copyText(e.target.dataset.msg, e.target)
      }
    })


    const announcementInput = qs('#tf-announcement')
    if (announcementInput) {
      announcementInput.addEventListener('input', function () {
        const tmpl    = getMsgByPlaceholder('opening', 'announcement')
        const preview = qs('#tf-announcement-preview')
        if (this.value.trim()) {
          preview.textContent = applyTemplate(tmpl, { announcement: this.value.trim() })
          preview.classList.remove('tf-preview--muted')
        } else {
          preview.textContent = 'Enter announcement text to preview'
          preview.classList.add('tf-preview--muted')
        }
      })

      qs('#tf-copy-announcement').addEventListener('click', function () {
        const val = announcementInput.value.trim()
        if (!val) { toast('Enter announcement text first'); return }
        const tmpl = getMsgByPlaceholder('opening', 'announcement')
        copyText(applyTemplate(tmpl, { announcement: val }), this)
      })
    }

    qs('#tf-copy-thanks').addEventListener('click', function () {
      if (0 === state.participants.length) {
        toast('Add participants first')
        return
      }
      copyText(qs('#tf-thanks-preview').dataset.msg, this)
    })

    qs('#tf-clipboard-copy-btn').addEventListener('click', () => {
      const el = qs('#tf-clipboard-text')
      if (el && ! el.classList.contains('tf-clipboard-text--empty')) {
        copyText(el.textContent)
      }
    })

    qs('#tf-reset-session-btn').addEventListener('click', resetSession)

    renderTable()
    refreshThanks()
  }

  document.addEventListener('DOMContentLoaded', init)
})()
