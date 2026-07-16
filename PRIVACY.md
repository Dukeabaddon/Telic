# Telic Privacy Policy

**Effective date:** July 16, 2026

This policy describes data handling for Telic's public Git plugin, npm package,
source adapters, and any future skills-only directory listing.

## Distribution shapes

The Codex Git plugin bundles workflow instructions and a local, model-free MCP
runtime. The `telic-mcp` npm package provides the same portable CLI and MCP
tools without installing the Codex skill. A future skills-only listing may
contain only workflow instructions.

None of these distributions operates a Telic-hosted service, creates a Telic
account, uses advertising cookies, or sends repository content to a service
controlled by the Telic maintainer.

When a user authorizes ChatGPT, Codex, or another host to read files or call
tools, that host processes the selected content under its own terms and privacy
policy. Telic's instructions ask the host to minimize context, redact secrets
and personal data from evidence, and avoid unsupported access.

## Local runtime

The runtime bundled with the Git plugin, or launched through `telic-mcp`, can
store task requests, selected repository context, artifacts, evidence, and
trace data on the user's machine. Its normal state directory is outside the
repository under the operating system's user-state location. The runtime does
not include telemetry, a hosted model service, or a Telic-controlled network
service.

Users control the repositories and tools they connect. They should not process
credentials, personal data, or confidential source unless they are authorized
to do so and have reviewed the host and local-state configuration.

## Retention and deletion

The Telic maintainer does not receive or retain plugin, skill, or runtime inputs
or outputs. Local runtime data remains on the user's device until the user
removes the applicable Telic state directory. Backups and host-provider
retention are outside Telic's control.

## Third parties

GitHub, npm, OpenAI, and any coding host or tool selected by the user operate
under their own policies. Telic does not control those services.

## Changes and contact

Material changes will be published in this repository. For non-sensitive
privacy questions, open an issue at
<https://github.com/Dukeabaddon/Telic/issues>. Do not put credentials, private
source, or personal data in a public issue.
