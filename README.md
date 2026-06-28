# SophiaVPN

[English](README.md) | [中文](README.zh-CN.md)

SophiaVPN is a macOS-focused VPN and proxy client derived from the macOS branch of SilverVPN. It is separated into an independent repository because its product direction, system integration strategy, and compatibility requirements are different from the Linux/server-oriented SilverVPN project.

SophiaVPN currently focuses on a safe proxy-only workflow for macOS:

- local mihomo HTTP/SOCKS proxy;
- desktop controller for macOS;
- headless CLI workflow;
- subscription import and profile management;
- node switching and delay tests;
- terminal proxy integration;
- optional, explicit macOS system proxy integration;
- conflict warnings for other VPN/proxy clients.

## Status

SophiaVPN is currently in early macOS migration. The first goal is to migrate the existing SilverVPN macOS branch into this repository, then continue development here.

## Safety direction

SophiaVPN should not automatically take over macOS system proxy when other VPN/proxy software is detected. iNodeVPN may be allowed as a coexisting network client, but Shadowrocket, ExpressVPN, ClashX/Clash Verge, Surge, sing-box, and similar proxy/VPN clients should trigger a warning and disable automatic system-proxy takeover.

## Source

Initial migration source:

```text
Silver-Zhang/SilverVPN:macos
```
