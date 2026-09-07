;( function () {
	'use strict'

	const STORAGE_KEY   = 'testflow_console_test_chat'
	const WARN_SECONDS  = 50 * 60
	const CHIME_SECONDS = 55 * 60

	// ── State ────────────────────────────────────────────────────

	const state = {
		attendance:           [],
		notes:                '',
		decisions:            '',
		actionItems:          '',
		announcement:         '',
		agendaUrl:            '',
		facilitator:          '',
		noteTaker:            '',
		elapsedAtStart:       0,
		startTimestamp:       null,
		timerRunning:         false,
		timerInterval:        null,
		wasRunningBeforeEdit: false,
		chimePlayed:          false,
	}

	// ── Template engine ──────────────────────────────────────────

	function applyTemplate( tmpl, vars ) {
		return tmpl.replace( /\{(\w+)\}/g, ( _, key ) => key in vars ? vars[ key ] : `{${ key }}` )
	}

	function getVars() {
		return {
			agenda_url:  state.agendaUrl   || '{agenda_url}',
			facilitator: state.facilitator  || '{facilitator}',
			note_taker:  state.noteTaker    || state.facilitator || '{note_taker}',
		}
	}

	function refreshTemplatePreviews() {
		const vars = getVars()
		qsa( '.tf-template-preview' ).forEach( el => {
			el.textContent = applyTemplate( el.dataset.template, vars )
		} )
	}

	// ── Timer ────────────────────────────────────────────────────

	function pad( n ) {
		return String( n ).padStart( 2, '0' )
	}

	function getElapsed() {
		if ( state.timerRunning && null !== state.startTimestamp ) {
			return state.elapsedAtStart + Math.floor( ( Date.now() - state.startTimestamp ) / 1000 )
		}
		return state.elapsedAtStart
	}

	function playChime() {
		if ( ! ( window.AudioContext || window.webkitAudioContext ) ) return
		const ctx   = new ( window.AudioContext || window.webkitAudioContext )()
		const now   = ctx.currentTime
		const notes = [ 523.25, 659.25, 783.99 ]
		notes.forEach( ( freq, i ) => {
			const osc  = ctx.createOscillator()
			const gain = ctx.createGain()
			osc.connect( gain )
			gain.connect( ctx.destination )
			osc.type            = 'sine'
			osc.frequency.value = freq
			const start = now + i * 0.18
			gain.gain.setValueAtTime( 0, start )
			gain.gain.linearRampToValueAtTime( 0.25, start + 0.01 )
			gain.gain.exponentialRampToValueAtTime( 0.001, start + 1.8 )
			osc.start( start )
			osc.stop( start + 1.8 )
		} )
	}

	function updateTimerDisplay() {
		const elapsed  = getElapsed()
		const el       = qs( '#tf-timer' )
		el.textContent = `${ pad( Math.floor( elapsed / 60 ) ) }:${ pad( elapsed % 60 ) }`
		el.classList.toggle( 'is-warning', elapsed >= WARN_SECONDS )
	}

	function tickTimer() {
		updateTimerDisplay()
		if ( ! state.chimePlayed && getElapsed() >= CHIME_SECONDS ) {
			state.chimePlayed = true
			playChime()
		}
		saveState()
	}

	function toggleTimer() {
		if ( state.timerRunning ) {
			state.elapsedAtStart = getElapsed()
			state.startTimestamp = null
			clearInterval( state.timerInterval )
			state.timerRunning = false
			qs( '#tf-timer-btn' ).textContent = '▶ Resume'
		} else {
			state.startTimestamp = Date.now()
			state.timerInterval  = setInterval( tickTimer, 1000 )
			state.timerRunning   = true
			qs( '#tf-timer-btn' ).textContent = '⏸ Pause'
		}
		saveState()
	}

	function resetTimer() {
		clearInterval( state.timerInterval )
		state.timerRunning   = false
		state.timerInterval  = null
		state.startTimestamp = null
		state.elapsedAtStart = 0
		state.chimePlayed    = false
		qs( '#tf-timer' ).textContent = '00:00'
		qs( '#tf-timer' ).classList.remove( 'is-warning' )
		qs( '#tf-timer-btn' ).textContent = '▶ Start'
		saveState()
	}

	// ── Edit elapsed time ────────────────────────────────────────

	function parseTimeInput( str ) {
		str = str.trim()
		if ( /^\d{1,2}:\d{2}$/.test( str ) ) {
			const parts = str.split( ':' )
			return parseInt( parts[ 0 ], 10 ) * 60 + parseInt( parts[ 1 ], 10 )
		}
		if ( /^\d+$/.test( str ) ) return parseInt( str, 10 ) * 60
		return null
	}

	function exitEditTimer( applyChanges ) {
		const el  = qs( '#tf-timer' )
		const btn = qs( '#tf-edit-limit-btn' )
		if ( applyChanges ) {
			const seconds = parseTimeInput( el.textContent )
			if ( null !== seconds && seconds >= 0 ) state.elapsedAtStart = seconds
		}
		if ( state.wasRunningBeforeEdit ) {
			state.startTimestamp = Date.now()
			state.timerInterval  = setInterval( tickTimer, 1000 )
			state.timerRunning   = true
			qs( '#tf-timer-btn' ).textContent = '⏸ Pause'
		}
		state.wasRunningBeforeEdit     = false
		qs( '#tf-timer-btn' ).disabled = false
		updateTimerDisplay()
		saveState()
		el.contentEditable = 'false'
		btn.textContent    = 'Edit'
	}

	function toggleEditTimer() {
		const el  = qs( '#tf-timer' )
		const btn = qs( '#tf-edit-limit-btn' )
		if ( 'true' === el.contentEditable ) { exitEditTimer( true ); return }
		state.wasRunningBeforeEdit = state.timerRunning
		if ( state.timerRunning ) {
			state.elapsedAtStart = getElapsed()
			state.startTimestamp = null
			clearInterval( state.timerInterval )
			state.timerRunning = false
		}
		qs( '#tf-timer-btn' ).disabled = true
		el.contentEditable = 'true'
		el.focus()
		const range = document.createRange()
		range.selectNodeContents( el )
		const sel = window.getSelection()
		sel.removeAllRanges()
		sel.addRange( range )
		btn.textContent = 'Save'
	}

	// ── Persistence ──────────────────────────────────────────────

	function saveState() {
		localStorage.setItem( STORAGE_KEY, JSON.stringify( {
			attendance: state.attendance,
			notes: state.notes,
			decisions: state.decisions,
			actionItems: state.actionItems,
			announcement: state.announcement,
			agendaUrl:      state.agendaUrl,
			facilitator:    state.facilitator,
			noteTaker:      state.noteTaker,
			elapsedAtStart: state.elapsedAtStart,
			startTimestamp: state.startTimestamp,
			timerRunning:   state.timerRunning,
			chimePlayed:    state.chimePlayed,
		} ) )
	}

	function loadState() {
		const raw = localStorage.getItem( STORAGE_KEY )
		if ( ! raw ) return
		try {
			const data = JSON.parse( raw )
			state.attendance   = Array.isArray( data.attendance ) ? data.attendance : []
			state.notes        = data.notes        || ''
			state.decisions    = data.decisions    || ''
			state.actionItems  = data.actionItems  || ''
			state.announcement = data.announcement || ''
			state.agendaUrl   = data.agendaUrl   || ''
			state.facilitator = data.facilitator  || ''
			state.noteTaker   = data.noteTaker    || ''
			state.chimePlayed = data.chimePlayed  || false
			if ( data.timerRunning && data.startTimestamp ) {
				state.elapsedAtStart = data.elapsedAtStart || 0
				state.startTimestamp = data.startTimestamp
				state.timerRunning   = true
				state.timerInterval  = setInterval( tickTimer, 1000 )
				qs( '#tf-timer-btn' ).textContent = '⏸ Pause'
			} else {
				state.elapsedAtStart = data.elapsedAtStart || 0
			}
			if ( state.agendaUrl )   qs( '#tf-agenda-url' ).value   = state.agendaUrl
			if ( state.facilitator ) qs( '#tf-facilitator' ).value   = state.facilitator
			if ( state.noteTaker )   qs( '#tf-note-taker' ).value    = state.noteTaker
			updateTimerDisplay()
			refreshTemplatePreviews()
		} catch ( e ) {
			localStorage.removeItem( STORAGE_KEY )
		}
	}

	function resetSession() {
		// eslint-disable-next-line no-alert
		if ( ! window.confirm( 'Reset the session? This will clear all variables and reset the timer.' ) ) return
		clearInterval( state.timerInterval )
		Object.assign( state, {
			attendance: [], notes: '',
			decisions: '', actionItems: '', announcement: '',
			agendaUrl: '', facilitator: '', noteTaker: '',
			elapsedAtStart: 0, startTimestamp: null,
			timerRunning: false, timerInterval: null, chimePlayed: false,
		} )
		qs( '#tf-timer' ).textContent = '00:00'
		qs( '#tf-timer' ).classList.remove( 'is-warning' )
		qs( '#tf-timer-btn' ).textContent = '▶ Start'
		qs( '#tf-agenda-url' ).value   = ''
		qs( '#tf-facilitator' ).value  = ''
		qs( '#tf-note-taker' ).value   = ''

		;[ '#tf-chat-decisions', '#tf-chat-actions', '#tf-chat-announcement' ].forEach( sel => {
			const el = qs( sel )
			if ( el ) el.value = ''
		} )

		const notesOut = qs( '#tf-chat-notes-out' )
		if ( notesOut ) notesOut.textContent = ''

		// The Slack setup deliberately survives: it lives under its own key and
		// is shared with the scrub screen, so wiping it here would surprise you
		// on the other screen.
		localStorage.removeItem( STORAGE_KEY )
		renderAttendance()
		refreshTemplatePreviews()
	}

	// ── Clipboard ────────────────────────────────────────────────

	function updateClipboardBar( text ) {
		const el = qs( '#tf-clipboard-text' )
		if ( el ) {
			el.textContent = text
			el.classList.remove( 'tf-clipboard-text--empty' )
		}
	}

	function copyText( text, btn ) {
		const onSuccess = () => {
			toast( 'Copied to clipboard' )
			updateClipboardBar( text )
			if ( btn ) flashCopied( btn )
		}
		if ( navigator.clipboard ) { navigator.clipboard.writeText( text ).then( onSuccess ); return }
		const ta = document.createElement( 'textarea' )
		ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'
		document.body.appendChild( ta ); ta.select()
		document.execCommand( 'copy' ); document.body.removeChild( ta )
		onSuccess()
	}

	function flashCopied( btn ) {
		btn.classList.add( 'is-copied' )
		setTimeout( () => btn.classList.remove( 'is-copied' ), 1500 )
	}

	function toast( msg ) {
		const el = qs( '#tf-toast' )
		el.textContent = msg; el.classList.add( 'is-visible' )
		clearTimeout( el._tfTimer )
		el._tfTimer = setTimeout( () => el.classList.remove( 'is-visible' ), 2200 )
	}

	// ── DOM helpers ──────────────────────────────────────────────

	// Slack sending ---------------------------------------------
	// Reads the same stored config as the scrub screen and posts through the
	// same REST route, so a webhook saved once works on both screens.

	const SLACK_KEY = 'testflow_console_slack'

	let slackReady = false

	// Shared with the scrub screen on purpose: one Slack setup, two screens.
	function slackConfig() {
		try {
			const raw = localStorage.getItem( SLACK_KEY )
			const d = raw ? JSON.parse( raw ) : null
			return {
				url:     ( d && d.url ) || '',
				team:    ( d && d.team ) || '',
				channel: ( d && d.channel ) || '',
				thread:  ( d && d.thread ) || '',
				// Its own key. The scrub screen's `target` also carries "their",
				// meaning reply inside that person's own message, which is a
				// per-person idea that does not exist in a team chat. Sharing
				// the key left this select showing nothing.
				target:  ( d && d.chatTarget ) || 'channel',
				sendToThread: false !== ( d && d.sendToThread )
			}
		} catch ( e ) {
			return { url: '', team: '', channel: '', thread: '', target: 'channel', sendToThread: true }
		}
	}

	function saveSlackConfig( patch ) {
		let current = {}

		try {
			const raw = localStorage.getItem( SLACK_KEY )
			current = raw ? JSON.parse( raw ) : {}
		} catch ( e ) {
			current = {}
		}

		localStorage.setItem( SLACK_KEY, JSON.stringify( Object.assign( current, patch ) ) )
	}

	// https://app.slack.com/client/T024MFP4J/C03B0H5J0
	function parseChannelUrl( url ) {
		const m = String( url || '' ).match( /\/client\/(T[A-Z0-9]+)\/(C[A-Z0-9]+)/i )
		return m ? { team: m[ 1 ].toUpperCase(), channel: m[ 2 ].toUpperCase() } : null
	}

	// Accepts "Name | url" or a bare url, one per line, same as the scrub screen.
	function threadEntries() {
		return slackConfig().thread.split( '\n' )
			.map( line => line.trim() )
			.filter( Boolean )
			.map( line => {
				const parts = line.split( '|' )
				return parts.length > 1
					? { name: parts[ 0 ].trim(), url: parts.slice( 1 ).join( '|' ).trim() }
					: { name: '', url: line }
			} )
			.filter( e => e.url )
	}

	function threadTs() {
		const first = threadEntries()[ 0 ]
		const m = first ? first.url.match( /\/p(\d{10})(\d{6})/ ) : null
		return m ? m[ 1 ] + '.' + m[ 2 ] : ''
	}

	function api( path, opts ) {
		const cfg = window.tfConsoleTestChat || {}

		if ( ! cfg.restUrl ) {
			return Promise.reject( new Error( 'The REST endpoint was not provided to this screen.' ) )
		}

		return fetch( cfg.restUrl.replace( /\/$/, '' ) + path, Object.assign( {
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': cfg.nonce || ''
			}
		}, opts || {} ) ).then( r => r.json().then( body => {
			if ( ! r.ok ) {
				throw new Error( ( body && body.message ) || ( 'Request failed, status ' + r.status ) )
			}
			return body
		} ) )
	}

	function sendToSlack( text ) {
		if ( ! text || ! text.trim() ) {
			toast( 'Nothing to send' )
			return
		}

		const cfg = slackConfig()
		const ts = threadTs()
		const target = cfg.target || 'channel'
		const payload = { text, target }

		// Hand the channel over so /send can use the token path, which is the
		// only one that can choose a channel or post in a thread. Without it
		// every message fell back to the webhook.
		if ( cfg.channel ) {
			payload.channel = cfg.channel
		}

		if ( 'channel' !== target && ts ) {
			payload.thread_ts = ts
		}

		toast( 'Sending...' )

		api( '/send', { method: 'POST', body: JSON.stringify( payload ) } )
			.then( () => toast( 'Sent to Slack' ) )
			.catch( e => toast( 'Not sent. ' + e.message ) )
	}

	function resolveMessageFor( btn ) {
		if ( btn.dataset.msg ) {
			return btn.dataset.msg
		}

		if ( btn.dataset.template ) {
			return applyTemplate( btn.dataset.template, getVars() )
		}

		return ''
	}

	let slackHasToken = false

	function renderSlackStatus( s ) {
		const el = qs( '#tf-chat-slack-status' )

		if ( ! el ) {
			return
		}

		if ( ! s ) {
			el.textContent = 'Could not ask the site about the Slack setup.'
			return
		}

		const cfg = slackConfig()
		const bits = []

		bits.push( s.token_configured ? 'Bot token saved.' : 'No bot token.' )
		bits.push( s.configured ? 'Webhook saved.' : 'No webhook.' )
		bits.push( cfg.channel ? 'Channel ' + cfg.channel + '.' : 'No channel set.' )

		if ( ! s.token_configured && cfg.channel ) {
			bits.push( 'Without a token the webhook posts to its own channel whatever this says.' )
		}

		if ( ! s.token_configured ) {
			bits.push( 'Attendance needs a token, because reading a channel is not something a webhook can do.' )
		}

		el.textContent = bits.join( ' ' )
	}

	// ── Attendance ───────────────────────────────────────────────

	function attendanceStatus( msg ) {
		const el = qs( '#tf-chat-attendance-status' )
		if ( el ) el.textContent = msg
	}

	function pullAttendance() {
		const cfg = slackConfig()

		if ( ! cfg.channel ) {
			attendanceStatus( 'Paste the channel URL above first.' )
			return
		}

		// Same window as the scrub screen: from the moment Start was pressed,
		// not a rolling guess. Without a start time there is nothing sensible
		// to ask for, so fall back to the last two hours of a one hour meeting.
		// True start, not the last resume: elapsedAtStart holds whatever ran
		// before the current run. When paused there is no startTimestamp, so
		// work back from now instead of silently falling to the 2 hour default.
		let since = 0

		if ( state.startTimestamp ) {
			since = Math.floor( ( state.startTimestamp - state.elapsedAtStart * 1000 ) / 1000 )
		} else if ( state.elapsedAtStart ) {
			since = Math.floor( Date.now() / 1000 ) - state.elapsedAtStart
		}

		attendanceStatus( 'Reading the channel...' )

		api( '/thread?channel=' + encodeURIComponent( cfg.channel )
			+ ( since ? '&oldest=' + since : '&hours=2' ), { method: 'GET' } )
			.then( r => {
				const people = ( r.people || [] ).filter( p => ! p.is_bot )

				state.attendance = people.map( p => ( {
					name: p.name,
					real: p.real || '',
					replies: p.replies || 0,
					wporg: p.wporg || '',
					present: true
				} ) )

				saveState()
				renderAttendance()

				attendanceStatus( people.length
					? people.length + ' spoke, from ' + ( r.total || 0 ) + ' messages'
					+ ( since ? ' since the timer started.' : ' in the last 2 hours.' )
					: 'Nobody has posted in that window yet.' )
			} )
			.catch( e => attendanceStatus( e.message ) )
	}

	function renderAttendance() {
		const host = qs( '#tf-chat-attendance-list' )

		if ( ! host ) {
			return
		}

		host.textContent = ''

		if ( ! state.attendance.length ) {
			const p = document.createElement( 'p' )
			p.className = 'tf-import-note'
			p.textContent = 'Nobody pulled yet.'
			host.appendChild( p )
			return
		}

		const list = document.createElement( 'ul' )
		list.className = 'tf-attendance-list'

		state.attendance.forEach( ( person, i ) => {
			const li = document.createElement( 'li' )
			const label = document.createElement( 'label' )
			const box = document.createElement( 'input' )

			box.type = 'checkbox'
			box.checked = person.present
			box.addEventListener( 'change', () => {
				state.attendance[ i ].present = box.checked
				saveState()
			} )

			label.appendChild( box )
			label.appendChild( document.createTextNode( ' @' + person.name ) )

			if ( person.real && person.real !== person.name ) {
				const real = document.createElement( 'span' )
				real.className = 'tf-attendance-real'
				real.textContent = person.real
				label.appendChild( real )
			}

			const count = document.createElement( 'span' )
			count.className = 'tf-attendance-count'
			count.textContent = person.replies + ( 1 === person.replies ? ' message' : ' messages' )
			label.appendChild( count )

			li.appendChild( label )

			if ( person.wporg ) {
				const a = document.createElement( 'a' )
				a.href = person.wporg
				a.target = '_blank'
				a.rel = 'noopener noreferrer'
				a.className = 'tf-wporg-link'
				a.textContent = 'profile'
				li.appendChild( a )
			}

			list.appendChild( li )
		} )

		host.appendChild( list )
	}

	function attendanceText() {
		const here = state.attendance.filter( p => p.present ).map( p => '@' + p.name )

		if ( ! here.length ) {
			return ''
		}

		return 'Attendance for today: ' + here.join( ', ' )
			+ ' (' + here.length + ( 1 === here.length ? ' person' : ' people' ) + ').'
	}

	// ── Announcements ────────────────────────────────────────────

	function loadAnnouncements( force ) {
		const picker = qs( '#tf-chat-announcement-picker' )

		if ( ! picker ) {
			return
		}

		picker.innerHTML = '<option value="">Loading recent WordPress posts...</option>'

		api( '/announcements' + ( force ? '?refresh=1' : '' ), { method: 'GET' } )
			.then( r => {
				const items = r.items || []

				picker.innerHTML = ''

				const first = document.createElement( 'option' )
				first.value = ''
				first.textContent = items.length
					? 'Recent WordPress posts, pick one to fill the box'
					: 'No posts came back'
				picker.appendChild( first )

				items.forEach( item => {
					const opt = document.createElement( 'option' )
					opt.value = item.title + ' - ' + item.link
					opt.textContent = ( item.source ? '[' + item.source + '] ' : '' ) + item.title
					picker.appendChild( opt )
				} )
			} )
			.catch( () => {
				picker.innerHTML = '<option value="">Could not reach the feeds</option>'
			} )
	}

	// ── Meeting notes ────────────────────────────────────────────

	function lines( sel ) {
		const el = qs( sel )
		return el ? el.value.split( '\n' ).map( l => l.trim() ).filter( Boolean ) : []
	}

	function buildNotes() {
		const here = state.attendance.filter( p => p.present )
		const decisions = lines( '#tf-chat-decisions' )
		const actions = lines( '#tf-chat-actions' )
		const out = []

		out.push( '## Test Chat notes' )
		out.push( '' )

		if ( state.agendaUrl ) {
			out.push( 'Agenda: ' + state.agendaUrl )
		}

		if ( state.facilitator ) {
			out.push( 'Facilitator: ' + state.facilitator )
		}

		if ( state.noteTaker ) {
			out.push( 'Notes: ' + state.noteTaker )
		}

		out.push( '' )
		out.push( '### Attendance' )

		out.push( here.length
			? here.map( p => '- @' + p.name + ( p.wporg ? ' (' + p.wporg + ')' : '' ) ).join( '\n' )
			: '- Nobody pulled. Use the attendance panel, or add names by hand.' );

		out.push( '' )
		out.push( '### Decisions' )
		out.push( decisions.length ? decisions.map( d => '- ' + d ).join( '\n' ) : '- None recorded.' )

		out.push( '' )
		out.push( '### Action items' )

		if ( actions.length ) {
			out.push( actions.map( a => {
				const parts = a.split( '|' )
				return parts.length > 1
					? '- ' + parts[ 0 ].trim() + ': ' + parts.slice( 1 ).join( '|' ).trim()
					: '- ' + a
			} ).join( '\n' ) )
		} else {
			out.push( '- None recorded.' )
		}

		state.notes = out.join( '\n' )
		saveState()

		const box = qs( '#tf-chat-notes-out' )
		if ( box ) box.textContent = state.notes

		const status = qs( '#tf-chat-notes-status' )
		if ( status ) {
			status.textContent = here.length + ' present, ' + decisions.length
				+ ' decisions, ' + actions.length + ' action items.'
		}
	}

	function addSendButtons() {
		qsa( '.tf-copy-btn, .tf-template-copy' ).forEach( btn => {
			let send = btn.parentNode.querySelector( '.tf-send-btn' )

			if ( ! send ) {
				send = document.createElement( 'button' )
				send.type = 'button'
				send.className = 'tf-send-btn'
				send.textContent = 'Send'
				send.addEventListener( 'click', () => {
					const text = resolveMessageFor( btn )
					if ( ! text ) {
						toast( 'Nothing to send yet' )
						return
					}
					sendToSlack( text )
				} )
				let group = btn.parentNode.querySelector( '.tf-msg-actions' )

				if ( ! group ) {
					group = document.createElement( 'div' )
					group.className = 'tf-msg-actions'
					btn.parentNode.insertBefore( group, btn )
					group.appendChild( btn )
				}

				group.appendChild( send )
			}

			send.disabled = ! slackReady
			send.title = slackReady
				? 'Post this message to Slack'
				: 'Save a bot token or an incoming webhook on the Patch Testing Scrub screen first'
		} )
	}

	function loadSlackReadiness() {
		addSendButtons()

		api( '/webhook', { method: 'GET' } )
			.then( s => {
				// Either route can post. Checking only the webhook disabled
				// every button on a token-only setup, which is the setup the
				// rest of this plugin actually wants.
				slackReady = !! ( s.configured || s.token_configured )
				slackHasToken = !! s.token_configured
				addSendButtons()
				renderSlackStatus( s )
			} )
			.catch( () => {
				slackReady = false
				slackHasToken = false
				addSendButtons()
				renderSlackStatus( null )
			} )
	}

	function qs( sel )  { return document.querySelector( sel ) }
	function qsa( sel ) { return document.querySelectorAll( sel ) }

	// ── Init ─────────────────────────────────────────────────────

	function init() {
		loadState()

		qs( '#tf-timer-btn' ).addEventListener( 'click', toggleTimer )

		qs( '#tf-timer-reset' ).addEventListener( 'click', () => {
			// eslint-disable-next-line no-alert
			if ( window.confirm( 'Reset the session timer?' ) ) resetTimer()
		} )

		qs( '#tf-edit-limit-btn' ).addEventListener( 'click', toggleEditTimer )

		qs( '#tf-timer' ).addEventListener( 'keydown', e => {
			if ( 'Enter' === e.key ) { e.preventDefault(); exitEditTimer( true ) }
			if ( 'Escape' === e.key ) exitEditTimer( false )
		} )

		qs( '#tf-timer' ).addEventListener( 'keypress', e => {
			if ( ! /^[\d:]$/.test( e.key ) ) e.preventDefault()
		} )

		const varInputs = [
			{ id: '#tf-agenda-url',  key: 'agendaUrl' },
			{ id: '#tf-facilitator', key: 'facilitator' },
			{ id: '#tf-note-taker',  key: 'noteTaker' },
		]

		varInputs.forEach( ( { id, key } ) => {
			qs( id ).addEventListener( 'input', function () {
				state[ key ] = this.value.trim()
				refreshTemplatePreviews()
				saveState()
			} )
		} )

		document.addEventListener( 'click', e => {
			if ( e.target.matches( '.tf-copy-btn[data-msg]' ) ) {
				copyText( e.target.dataset.msg, e.target )
			}
			if ( e.target.matches( '.tf-template-copy' ) ) {
				copyText( applyTemplate( e.target.dataset.template, getVars() ), e.target )
			}
		} )

		// ── Slack fields ─────────────────────────────────────
		const slackUrl = qs( '#tf-chat-slack-url' )
		const slackThread = qs( '#tf-chat-slack-thread' )
		const sendTarget = qs( '#tf-chat-send-target' )
		const cfg = slackConfig()

		if ( slackUrl ) {
			slackUrl.value = cfg.url
			slackUrl.addEventListener( 'input', function () {
				const parsed = parseChannelUrl( this.value )

				saveSlackConfig( parsed
					? { url: this.value.trim(), team: parsed.team, channel: parsed.channel }
					: { url: this.value.trim() } )

				loadSlackReadiness()
			} )
		}

		if ( slackThread ) {
			slackThread.value = cfg.thread
			slackThread.addEventListener( 'input', function () {
				saveSlackConfig( { thread: this.value } )
			} )

			if ( window.tfThreads ) {
				window.tfThreads.attach( slackThread )
			}
		}

		if ( sendTarget ) {
			// Guard the assignment: an unknown value silently blanks a select.
			sendTarget.value = [ 'channel', 'thread', 'both' ].indexOf( cfg.target ) !== -1
				? cfg.target
				: 'channel'
			sendTarget.addEventListener( 'change', function () {
				saveSlackConfig( { chatTarget: this.value } )
			} )
		}

		// ── Attendance ───────────────────────────────────────
		const attPull = qs( '#tf-chat-attendance-pull' )
		if ( attPull ) attPull.addEventListener( 'click', pullAttendance )

		const attCopy = qs( '#tf-chat-attendance-copy' )
		if ( attCopy ) {
			attCopy.addEventListener( 'click', () => {
				const text = attendanceText()
				if ( ! text ) { toast( 'Nobody ticked' ); return }
				copyText( text, attCopy )
			} )
		}

		const attSend = qs( '#tf-chat-attendance-send' )
		if ( attSend ) {
			attSend.addEventListener( 'click', () => {
				const text = attendanceText()
				if ( ! text ) { toast( 'Nobody ticked' ); return }
				sendToSlack( text )
			} )
		}

		renderAttendance()

		// ── Announcements ────────────────────────────────────
		const annPicker = qs( '#tf-chat-announcement-picker' )
		const annBox = qs( '#tf-chat-announcement' )

		if ( annPicker && annBox ) {
			annPicker.addEventListener( 'change', function () {
				if ( this.value ) annBox.value = this.value
			} )

			loadAnnouncements( false )
		}

		const annRefresh = qs( '#tf-chat-announcement-refresh' )
		if ( annRefresh ) annRefresh.addEventListener( 'click', () => loadAnnouncements( true ) )

		const annCopy = qs( '#tf-chat-announcement-copy' )
		if ( annCopy && annBox ) {
			annCopy.addEventListener( 'click', () => {
				if ( ! annBox.value.trim() ) { toast( 'Nothing to copy' ); return }
				copyText( annBox.value.trim(), annCopy )
			} )
		}

		const annSend = qs( '#tf-chat-announcement-send' )
		if ( annSend && annBox ) {
			annSend.addEventListener( 'click', () => sendToSlack( annBox.value.trim() ) )
		}

		// ── Notes ────────────────────────────────────────────
		// Typed mid-meeting, so an accidental refresh must not eat them.
		const persisted = [
			{ id: '#tf-chat-decisions',    key: 'decisions' },
			{ id: '#tf-chat-actions',      key: 'actionItems' },
			{ id: '#tf-chat-announcement', key: 'announcement' },
		]

		persisted.forEach( ( { id, key } ) => {
			const box = qs( id )

			if ( ! box ) {
				return
			}

			box.value = state[ key ] || ''
			box.addEventListener( 'input', function () {
				state[ key ] = this.value
				saveState()
			} )
		} )

		const notesBuild = qs( '#tf-chat-notes-build' )
		if ( notesBuild ) notesBuild.addEventListener( 'click', buildNotes )

		const notesCopy = qs( '#tf-chat-notes-copy' )
		if ( notesCopy ) {
			notesCopy.addEventListener( 'click', () => {
				if ( ! state.notes ) { toast( 'Build the notes first' ); return }
				copyText( state.notes, notesCopy )
			} )
		}

		if ( state.notes ) {
			const box = qs( '#tf-chat-notes-out' )
			if ( box ) box.textContent = state.notes
		}

		loadSlackReadiness()

		qs( '#tf-clipboard-copy-btn' ).addEventListener( 'click', () => {
			const el = qs( '#tf-clipboard-text' )
			if ( el && ! el.classList.contains( 'tf-clipboard-text--empty' ) ) {
				copyText( el.textContent )
			}
		} )

		qs( '#tf-reset-session-btn' ).addEventListener( 'click', resetSession )
	}

	document.addEventListener( 'DOMContentLoaded', init )
}() )
