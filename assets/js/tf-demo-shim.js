/**
 * Static-demo shim for the TestFlow Console.
 * - Provides the data WordPress would normally localise into each screen.
 * - Simulates the plugin's Slack REST routes so the demo behaves like the real
 *   plugin: Slack shows as configured, the Send buttons appear, and sending
 *   reports success. Nothing is actually posted anywhere.
 * Loaded BEFORE the Console scripts.
 */
(function () {
  'use strict';
  var M   = window.__TF_MESSAGES__ || {};
  var TC  = window.__TF_TESTCHAT__ || {};
  var API = '/tf-demo-api';

  window.tfConsoleScrub    = { messages: M,  restUrl: API, nonce: 'demo' };
  window.tfConsolePlan     = { messages: M,  restUrl: API, nonce: 'demo' };
  window.tfConsoleTestChat = { messages: TC, restUrl: API, nonce: 'demo' };
  window.tfConsoleOverview = { restUrl: API, nonce: 'demo' };

  // Pretend Slack is set up, so the Send UI is visible and usable.
  var STATUS = {
    configured: true,
    hint: 'https://hooks.slack.com/services/T0DEMO/B0DEMO/xxxx (demo, not real)',
    can_configure: true,
    token_configured: true,
    token_hint: 'xoxb-demo-...P0N0',
    token_rotating: false
  };
  var ANNOUNCEMENTS = { items: [
    { title: 'WordPress 7.1 release candidate is available for testing', link: 'https://make.wordpress.org/core/', date: '2026-09-05', stamp: 1788000000, source: 'Core' },
    { title: 'Test Team chat summary and the next patch scrub schedule', link: 'https://make.wordpress.org/test/', date: '2026-09-03', stamp: 1787800000, source: 'Test Team' },
    { title: 'This week at WordPress: highlights from across the project', link: 'https://wordpress.org/news/', date: '2026-09-02', stamp: 1787700000, source: 'News' }
  ], cached: false, errors: [] };

  function json(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }

  var native = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    try {
      var s = String(url || '');
      if (s.indexOf(API) !== -1) {
        if (s.indexOf('/webhook') !== -1) { return Promise.resolve(json(STATUS)); }
        if (s.indexOf('/token')   !== -1) { return Promise.resolve(json(STATUS)); }
        if (s.indexOf('/send')    !== -1) {
          var target = 'channel';
          try { target = (JSON.parse((opts && opts.body) || '{}').target) || 'channel'; } catch (e) {}
          return Promise.resolve(json({ in_thread: target !== 'channel', broadcast: target === 'both', as: 'app' }));
        }
        if (s.indexOf('/announcements') !== -1) { return Promise.resolve(json(ANNOUNCEMENTS)); }
        if (s.indexOf('/thread')    !== -1) { return Promise.resolve(json({ participants: [], messages: [] })); }
        if (s.indexOf('/gutenberg') !== -1) { return Promise.resolve(json({ items: [] })); }
        return Promise.resolve(json({}));
      }
      // Any other relative call: answer benignly rather than 404.
      if (s.indexOf('http') !== 0 && s.indexOf('//') !== 0) { return Promise.resolve(json({})); }
    } catch (e) {}
    return native ? native(url, opts) : Promise.reject(new Error('fetch unavailable'));
  };
})();
