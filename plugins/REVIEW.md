# CHAT.0110 review dossier

Package version 0.4.5, MCP/API protocol 2.1.0. Both package statuses are
not-submitted. Sources: apps/cli/src/connector.ts, connector-state.ts and
packages/chat-protocol. Build: bun run package:plugins. ZIP/SHA-256 files:
apps/web/public/downloads. Packaging requires Bun 1.3.14 and Python 3's standard
zipfile library. Generated ZIPs/server bundles are not committed; bun run build
rebuilds them before Vite. Package changes require a new version after release.

## Package boundaries

| Package | Access | Automatic delivery | Admission |
|---|---|---|---|
| ChatGPT / Codex | Shared OAuth remote MCP, scope chat:agent | Depends on the actual host; remote MCP alone does not wake idle sessions | No local/hooks; publisher/portal review is separate |
| Claude Code | Local MCP, existing gh login, CHAT.0110 only | Only an authorized channel with probe acknowledgement | Client allowlist/official review is separate |

The plugin does not start new models or AI sessions, scan all workspace files,
modify client configuration/permissions, or self-approve trust. The authorized
user selects the chat and exact session. Historical intent does not authorize
an arbitrary new executor. Stop/off/revoke must not revive old tasks. The
dispatcher candidate limits chains to three turns/15 minutes; production state
must be verified separately.

Messages and replies live in a GitHub branch/draft PR; queues/claims live on the
server; local recovery state is private. Data protection runs before publication
but does not promise perfect detection. Removing the plugin does not erase Git
history. No paid scanning API is used.

## Before publisher submission

- Confirm publisher eligibility and portal requirements. License is optional
  for the current step; its absence is not itself a required submission gate.
- Confirm real public privacy/terms/support URLs and the support contact.
- Provide a dedicated reviewer account with minimal access and revocation
  instructions. Enter credentials only through the secure portal, never Git.
- Remote MCP protocol 2.1.0 was released with PR #28. Package 0.4.4 added approved
  privacy/terms links. Version 0.4.5 removes translated listing entries and uses
  English listing/setup documentation without changing OAuth, queues or tools.
- Test clean installation, enable/disable, client restart/revoke and real host
  delivery on target applications. Package validation is not runtime proof.
- Do not include Codex hooks in the public review ZIP. OpenAI local MCP
  submission is partner-gated; the local Claude bundle is not a remote package.
- Anthropic channel approval remains separate; packaging does not add allowlist
  admission.

The remote package includes five positive and three negative cases and English
release notes. These are review instructions, not completed reviewer tests.
The owner supplied Alex Davidov / alexdavidov127@gmail.com. Individual identity
is Approved in the selected portal organization. Privacy/terms were approved
by the owner and are publicly served. The same draft has imported 0.4.4;
the 0.4.5 candidate still needs upload and revalidation. Domain verification,
OAuth and the 0.4.4 catalog scan passed in that draft; they are not proof that a
later upload is submitted, approved or published.

Historical public replay video:
https://github.com/Alex011082/chat.0110/releases/tag/review-demo-pr206-20261106
The video is marked sample/historical replay, not live AI or all 5+3 client
acceptance. Its URL was saved in the draft. The portal still requires working
reviewer credentials; final Submit was disabled with "Test credentials is
required." No fictional credentials are supplied. Check current portal state
and docs/publication/submission-readiness.md in the repository separately.

Reviewers can build from source, compare SHA-256, inspect manifests and run
stdio fixtures without a model. Packages contain no test credentials,
production cookies, keys, local session/socket IDs or user assets.

## Candidate checks

- bun test, bun run typecheck, bun run build, on CI only for this preparation.
- claude plugin validate --strict plugins/claude-code, including a clean ZIP
  extraction when validating that package.
- Compare portable plugin.json/mcp.json with their official JSON schemas.
- Check ZIP CRC, SHA-256 and reproducible builds. The remote ZIP guard checks
  English base listing, absence of Cyrillic packaged text, lengths, manifest
  consistency, fixed HTTPS MCP URL, icons and all eight review cases.
- For unpacked stdio smoke tests, point CHAT0110_TEST_CONNECTOR to
  server/connector.js and run bun test apps/cli/test/plugin-channel.test.ts.
  The test supplies fake gh and loopback API, not real credentials/models.
- Real-client acceptance remains separate: exact alias on/off, historical
  intent without false readiness, no unwanted navigation/popups, localization,
  desktop/mobile/keyboard and downloading the actual ZIP with application/zip.

Official references:
https://developers.openai.com/plugins/build/plugins
https://developers.openai.com/plugins/deploy/submission
https://developers.openai.com/plugins/deploy/desktop-only
https://code.claude.com/docs/en/plugins-reference
https://code.claude.com/docs/en/channels-reference
