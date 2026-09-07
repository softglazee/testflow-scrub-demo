/**
 * Static-demo shim for the TestFlow Console.
 * Provides the data WordPress would normally localise into the page, and stubs
 * the server-side Slack REST calls so the demo degrades gracefully.
 * Loaded BEFORE the Console scripts.
 */
(function () {
  'use strict';
  var M  = window.__TF_MESSAGES__ || {};
  var TC = window.__TF_TESTCHAT__ || {};

  window.tfConsoleScrub    = { messages: M,  restUrl: '', nonce: '' };
  window.tfConsolePlan     = { messages: M,  restUrl: '', nonce: '' };
  window.tfConsoleTestChat = { messages: TC, restUrl: '', nonce: '' };
  window.tfConsoleOverview = { restUrl: '', nonce: '' };

  // The Console talks to a WordPress REST namespace for Slack sending. That is
  // server-side and not available on a static host, so intercept those
  // (relative) calls and answer "not configured" instead of erroring.
  var native = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    try {
      var s = String(url || '');
      var isAbsolute = s.indexOf('http') === 0 || s.indexOf('//') === 0;
      if (!isAbsolute) {
        return Promise.resolve(new Response(
          '{"configured":false,"demo":true}',
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ));
      }
    } catch (e) {}
    return native ? native(url, opts) : Promise.reject(new Error('fetch unavailable'));
  };
})();
