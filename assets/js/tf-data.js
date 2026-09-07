window.__TF_MESSAGES__={
  "opening": {
    "duration": "2â€“3 min",
    "items": [
      { "label": "Announce start", "text": "/here We are starting today's <patch-testing-scrub>" },
      { "label": "Welcome", "text": "Hello everyone ðŸ‘‹" },
      {
        "label": "Invite participants",
        "text": "If you're around, we'd love your help with testing and sharing reports."
      },
      {
        "label": "Call for testers",
        "text": "If you're ready to start patch testing, please reply in this thread so I can assign you a ticket. ðŸ§µ"
      },
      {
        "label": "Announcement",
        "text": "Before we start, {announcement}. Feel free to try it out and share your feedback."
      }
    ]
  },
  "assignment": {
    "items": [
      {
        "key": "first_assign",
        "label": "First assignment",
        "text": "Thank you @{username}, for joining us today. You can start working on {url}"
      },
      {
        "key": "followup",
        "label": "Follow-up",
        "text": "@{username} Thank you for adding a report. Here's another one you can try: {url}"
      }
    ]
  },
  "assigning_tickets": {
    "duration": "40â€“50 min",
    "items": [
      {
        "note": true,
        "text": "Use the tracker on the right to assign tickets. The assignment message is automatically copied to your clipboard when you click Assign."
      },
      {
        "bullet": true,
        "text": "Prioritize tickets that have a numbered milestone (e.g. Milestone: 7.1) then Future release tickets."
      },
      {
        "bullet": true,
        "text": "Match ticket complexity to the participant's experience level where possible."
      }
    ]
  },
  "monitoring": {
    "duration": "ongoing",
    "items": [
      {
        "note": true,
        "text": "Keep an eye on the thread throughout the session. Acknowledge reports as they come in and offer a new ticket when someone is ready."
      },
      {
        "label": "Acknowledge report",
        "text": "Great work @[USERNAME], thanks for the report!"
      },
      {
        "label": "Another ticket",
        "text": "Thanks @[USERNAME]! Here's another one you can try: [TICKET_URL]"
      }
    ]
  },
  "closing": {
    "duration": "2â€“3 min",
    "items": [
      { "label": "End session", "text": "Well, this marks the end of today's </patch-testing-session>" },
      {
        "label": "Reassure participants",
        "text": "Feel free to ping me if you need to comment on anything, and also if you have not finished with your patch testing, you can continue for as long as you want, and ping me if you have any trouble finishing."
      },
      { "label": "Thank participants", "text": "Thanks {participants} for coming today. ðŸŽ‰" }
    ]
  }
}
;
window.__TF_TESTCHAT__={
  "opening": {
    "duration": "2â€“3 min",
    "items": [
      {
        "label": "Announce start",
        "text": "/here Hey everyone! Please join us in #core-test for this week's Test Team chat."
      },
      {
        "label": "Announce start (alternative)",
        "text": "/here We are starting now today's <test-chat>"
      },
      {
        "label": "Welcome",
        "text": "Hello and welcome to this bi-weekly test team chat meeting!"
      }
    ]
  },
  "attendance": {
    "duration": "2 min",
    "items": [
      {
        "label": "Attendance check",
        "text": "Who is joining us today? Please reply in the thread:\n1. Please say hello and note your WordPress.org profile username, as we will use this to record attendees in the notes.\n2. Feel welcome to introduce yourself briefly and share a flag or your favorite emoji!"
      },
      {
        "label": "Async note",
        "text": "If you're joining this chat async, please add your details to the thread later and include (async) after your name. This helps us review meeting times and encourage participation across all time zones."
      }
    ]
  },
  "agenda": {
    "duration": "1 min",
    "items": [
      {
        "label": "Share agenda",
        "text": "Today's chat agenda can be found here. Please take a look.\n\n{agenda_url}"
      }
    ]
  },
  "meeting_notes": {
    "duration": "1 min",
    "items": [
      {
        "label": "Section header",
        "text": "`Meeting Notes`"
      },
      {
        "label": "Facilitator & note-taker (same person)",
        "text": "Today's session facilitator and note-taker is {facilitator}"
      },
      {
        "label": "Facilitator & note-taker (different people)",
        "text": "Today's session facilitator is {facilitator} and the note-taker is {note_taker}"
      },
      {
        "label": "Upcoming meetings",
        "text": "You can check upcoming meetings here to stay up to date and get involved.\nhttps://make.wordpress.org/meetings/#test"
      },
      {
        "label": "Call to volunteer",
        "text": "ðŸ™Œ If youâ€™d like to volunteer for any open slot, please reply in the thread."
      }
    ]
  },
  "discussions": {
    "duration": "30â€“40 min",
    "items": [
      {
        "label": "Start discussions",
        "text": "Now let's move on to agenda item: `Test Team Discussions`"
      },
      {
        "note": true,
        "text": "FOR EACH AGENDA ITEM FOLLOW THE PATTERN"
      },
      {
        "note": true,
        "text": "Provide context if needed â€” share a brief explanation before opening the topic"
      },
      {
        "label": "Introduce the item",
        "text": "[AGENDA_ITEM_TITLE]"
      },
      {
        "label": "Transition between items",
        "text": "Then I think we can move to the next item in the agenda:\n[NEXT_AGENDA_ITEM]"
      },
      {
        "label": "When discussion needs continuation",
        "text": "Let's continue the conversation in the GitHub Issue and bring it back to another chat once there's more consensus on it."
      },
      {
        "label": "When wrapping up a discussion",
        "text": "We can discuss this on GitHub and make the required changes accordingly."
      }
    ]
  },
  "open_floor": {
    "duration": "5â€“10 min",
    "items": [
      {
        "label": "Time check",
        "text": "10min to end the meeting"
      },
      {
        "label": "Open floor",
        "text": "Let's move to the `Open Floor`"
      },
      {
        "label": "Invite contributions",
        "text": "Does anyone have anything they'd like to share or discuss?"
      }
    ]
  },
  "announcements": {
    "duration": "5â€“8 min",
    "items": [
      {
        "label": "Intro",
        "text": "Before we finish the meeting here you have a few links of relevant things that are happening in the WordPress Ecosystem and in the Test Team"
      },
      {
        "label": "Ecosystem announcements",
        "text": "`WordPress Ecosystem Announcements`"
      },
      {
        "label": "Test Team announcements",
        "text": "`Test Team Announcements`"
      },
      {
        "label": "Call for Testing",
        "text": "`Call for Testing`"
      },
      {
        "label": "Check for reactions",
        "text": "Any comment about any of these resources?"
      }
    ]
  },
  "closing": {
    "duration": "1â€“2 min",
    "items": [
      {
        "label": "Wrap up",
        "text": "As there are no more comments we can wrap up the meeting."
      },
      {
        "label": "Closing message",
        "text": "So this brings us to the end of our meeting </test-chat> thank you all for coming."
      }
    ]
  }
}
;

