# SophiaVPN Migration

This repository was initialized from:

```text
Silver-Zhang/SilverVPN:macos
```

SophiaVPN is intended to continue as the macOS-specific VPN/proxy client, separated from the Linux/server-oriented SilverVPN project.

Immediate post-migration tasks:

1. Rename product identifiers from SilverVPN/svpn to SophiaVPN/sophia where appropriate.
2. Add macOS VPN/proxy conflict detection.
3. Change the default `sophia on` behavior so it does not automatically take over macOS system proxy when conflicting VPN/proxy clients are detected.
4. Keep iNodeVPN as an allowed coexistence case with clear warning text.
