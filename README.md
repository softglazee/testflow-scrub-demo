# TestFlow Console — full demo (proof of concept)

A live, clickable demo of the **TestFlow Console** for
[test-handbook #184](https://github.com/WordPress/test-handbook/issues/184), built by
Azhar Ali ([@softglaze](https://profiles.wordpress.org/softglaze/)). It is a Console build of
[ozgursar/testflow](https://github.com/ozgursar/testflow) adding Trac CSV import, ticket-to-participant
difficulty matching, session history/export, a scrub-plan generator, and optional Slack sending.

**Live demo:** see the GitHub Pages URL for this repository.

All five screens are the plugin's real front-end (its own CSS and JavaScript), hosted as a static site:

- **Overview** — landing, pre-flight checklist, walkthrough
- **Patch Testing Scrub** — the main tracker: ticket import, difficulty levels, assignment, session history
- **Test Chat** — attendance, agenda, announcements, meeting notes
- **Tickets** — the imported ticket pool
- **Scrub Plan** — a plan a first-time moderator can hand to a team lead

Slack sending talks to a WordPress REST endpoint, which is server-side and therefore disabled on this
static host; every other function runs in the browser (localStorage). Demonstration only, not a plugin
release, and not affiliated with or endorsed by the WordPress project.
