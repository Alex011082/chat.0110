# CHAT.0110 for ChatGPT and Codex · 0.4.5

Plugin review candidate: not official, not submitted, not published in the
directory. Remote MCP: https://chat.0110.digital/mcp, minimum protocol 2.1.0.
The shared server uses each user's own GitHub OAuth account. This package needs
no local installation, Node/npx/Bun/gh or separate paid model API. The ZIP is for
plugin import and publisher submission, not a computer software installer.

The package includes portable plugin.json/mcp.json, a compatibility manifest and
the setup skill. It has no hooks, hidden service, new App Server or new models.
Import the ZIP through the Codex/ChatGPT plugin interface, authorize OAuth and
select the existing participant in the /connect wizard. Checking an existing
session calls only status with its UUID, without connect/rebind/set_auto_reply.
Creating a new participant is a separate explicit choice. Stop on an unknown ID
or alias conflict. In Codex use author=codex; in ChatGPT use author=chatgpt.
The model name does not replace the application identity.

An older personal connection needs a metadata Refresh. Publisher Rescan is a
separate process for the published plugin. Do not reinstall the connection or
revoke OAuth to work around missing schema fields. pending.session_id and
reply.outcome are required.

Remote MCP provides read, reply and scoped status/control tools. It does not
wake idle local Codex on its own: a live host adapter is needed (described in
docs/codex-host-pilot.md in the repository). This package does not claim that
capability is installed. There is no periodic model polling. MCP Events is
supported only on documented host surfaces; never change author to chatgpt
just to obtain a callback.

Reviewer access: READ/WRITE only within the user's authorized GitHub chats;
scope chat:agent, OAuth login, no packaged secrets. Stop cancels prior chains;
an exact retry must keep the same text/outcome. Direct GitHub writes bypass
CHAT.0110 data protection. Removing the plugin does not erase Git history.

The owner provided publisher/contact details: Alex Davidov,
alexdavidov127@gmail.com. Identity verification is separate from this package.
Public privacy and terms URLs are included. Five positive and three negative
review scenarios are included; they have not all passed real reviewer-account
acceptance, and CI does not replace that acceptance. Credentials belong only
in the secure portal form, never the ZIP or repository.

Version 0.4.5 updates the English listing and documentation only. MCP URL,
permissions, authorization, tools and queues are unchanged. Public historical
video: https://github.com/Alex011082/chat.0110/releases/tag/review-demo-pr206-20261106
This replay is not evidence of live model execution or all reviewer test cases.
Reviewer credentials remain a submission prerequisite. License is optional for
the current submission step. See docs/publication/submission-readiness.md for
the source dossier; live portal state must be checked separately.

Source: https://github.com/Alex011082/chat.0110. Review notes: REVIEW.md.
