# Security Policy

If you believe you have found a security-sensitive issue in `Clipboard Decay`, do
not open a public issue with exploit details first.

## Reporting

- prefer GitHub's private vulnerability reporting flow for this repository if it is available
- if private reporting is unavailable, open a minimal public issue that avoids exploit details and ask for a private contact path

## Scope

Security-sensitive reports may include:

- clipboard contents being exposed unexpectedly
- clipboard clearing happening for the wrong source in a way that weakens user expectations
- data retention behavior that contradicts the documented safety model
- packaging or update behavior that could mislead users about what code they are running

## Notes

- Wayland source detection is best-effort by design; reports should distinguish platform limits from implementation bugs
- Please include GNOME Shell version, distro, session type, and reproduction steps
