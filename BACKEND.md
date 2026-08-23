# Backend source boundary

PlayCounter's desktop client and public request/response contracts remain in
this repository. The production API, PostgreSQL migrations, IGDB ingestion
tools, moderation repository logic, and API deployment workflows moved to a
separate private repository on 2026-08-23.

## Historical MIT baseline

- Last public backend commit:
  `4838cb26866da2822fa924075f300cd68a6b05d1`
- Archival tag: `public-backend-mit-baseline-2026-08-23`
- License at that commit: MIT, Copyright (c) 2026 zntr1

The split is forward-looking. It does not revoke or narrow the MIT permissions
for backend source copies obtained from that commit or any earlier public
version. Removing operational files from the current tree also does not remove
them from Git history or existing forks.

## What remains verifiable

The public desktop source shows which local data is read, retained, and sent.
`packages/shared` documents the network payloads and responses used by the
official client. The privacy notice at
<https://playcounter.app/datenschutz.html> remains the authoritative statement
about production data processing.

Operational server source alone could not prove which build is deployed. The
public trust boundary therefore focuses on the distributed client, its network
contract, release signatures and checksums, and accurate privacy documentation.

## Coordinating contract changes

The private backend keeps a build-time copy of the shared contract package.
Any request or response change used by the official desktop client must be
updated here before that client version is released. Backend migrations and
deployments remain backward compatible with currently released clients.
