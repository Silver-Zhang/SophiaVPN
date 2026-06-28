# Subscription Profile Management

[English](profile-management.md) | [中文](profile-management.zh-CN.md)

SilverVPN stores imported subscriptions as profiles. A profile is a saved configuration source with its own local YAML file, display name and node metadata.

All profile operations are per-user and only modify the current user's `~/.config/SilverVPN` directory.

## List profiles

```bash
svpn profile list
```

The active profile is marked with `*`.

## Switch profile

```bash
svpn profile use 1
svpn profile use 'My Profile'
```

The selector can be a number, exact name, profile id, or a unique name fragment.

## Rename profile

```bash
svpn profile rename 1 'Work Nodes'
svpn profile rename 'Custom Subscription' 'Personal Nodes'
```

Renaming changes only local display metadata. It does not modify the subscription provider, subscription URL, or other users' profiles.

## Delete profile

```bash
svpn profile delete 2
svpn profile delete 1 --yes
```

Deleting the active profile requires `--yes`. SilverVPN keeps the active Clash config file when the active profile is deleted, so a running backend is not broken immediately.

## Safety boundaries

Profile commands:

- only operate under the current user's home directory;
- do not write `/etc`;
- do not change system routes or DNS;
- do not enable TUN;
- do not modify other users' files.
