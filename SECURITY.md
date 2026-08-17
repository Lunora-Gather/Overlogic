# Security Policy

## Reporting a vulnerability

Please do not publish exploit details in a public issue. Open a private GitHub
security report for this repository, or contact the repository owner through a
maintainer-controlled channel with:

- the affected release or commit;
- clear reproduction steps;
- the impact and any required user interaction;
- a minimal proof of concept when it is safe to share.

The project is currently a static client-side game. It does not provide account,
payment, cloud-save, leaderboard, or server-authoritative anti-cheat services.
Do not include personal save files, credentials, access tokens, or other private
data in a report. The local support bundle is intentionally bounded and should
be reviewed before sharing.

## Scope notes

- Client-side replay digests and receipts are integrity hints, not proof against
  a modified browser or a malicious client.
- Local storage is user-controlled and must not be treated as a secure vault.
- Future online services must add server-side authentication, authorization,
  rate limiting, validation, deletion controls, and audit logging before they
  are used for competitive or commercial entitlements.
- The release shell denies camera, microphone, geolocation, and payment
  capabilities through `Permissions-Policy`; the local dev server sends the
  same response header.
- Versioned local stores reject future envelopes instead of guessing their
  schema. A future operations manifest enters a visible maintenance-safe mode
  rather than silently applying unknown semantics.
