# Surface Pro 4 + Windows Hello Plan

The target tablet is a Surface Pro 4. That matters: Surface Pro 4 has a
front-facing Windows Hello face sign-in camera, so we can use the OS identity
stack instead of treating the device like a generic webcam tablet.

## What Windows Hello Can Do

Windows Hello can verify the signed-in Windows user with face/PIN and can sign
that user into Windows. App-facing APIs such as `UserConsentVerifier` are built
around "prove the current Windows user is present" flows.

Use this for:

- unlocking/signing into the Surface;
- verifying the active Windows user before showing a personal dashboard;
- mapping a Windows account to one Home Assistant dashboard/person profile;
- protecting sensitive Home Assistant controls behind a second Hello prompt.

## What Windows Hello Does Not Give Us

Windows Hello does not expose the enrolled face templates or a continuous stream
of "this face is Quinn" events to kiosk apps. Treat Hello as a secure OS
authentication boundary, not as an ambient multi-person recognition API.

If the kiosk is running under one shared Windows account, Hello can verify that
shared account, not silently identify every family member who walks up.

## Recommended Architecture

Use a hybrid design:

1. **Windows Hello owns secure identity.**
   Each household member gets a Windows account on the Surface with Windows
   Hello Face enrolled. The kiosk launches at sign-in and maps that Windows
   account to a Home Assistant dashboard.
2. **The kiosk owns the room experience.**
   The Electron app shows the photo frame, Home Assistant dashboard, local TTS,
   touch handling, and Home Assistant event bridge.
3. **Custom camera vision owns ambient presence.**
   Motion/person presence and optional non-security face labels run in the kiosk
   or a Home Assistant/Frigate-side service. These labels are for greetings and
   personalization hints only.

## Primary UX Flow

1. Surface is locked or showing its photo/slideshow state.
2. A person approaches or taps the screen.
3. Windows Hello signs in the person's Windows account.
4. The kiosk autostarts for that account.
5. The kiosk says the configured greeting and opens that person's Home Assistant
   dashboard.
6. After an idle timeout, the kiosk returns to photos or locks the Surface.

## Shared-Account Alternative

If you want one always-on shared kiosk user instead of separate Windows
accounts, use the RGB/IR camera through the kiosk's own face recognition layer.
In that mode, Windows Hello is useful only as an explicit "verify before
sensitive action" prompt, not as the general person detector.

## Implementation Notes

- Configure Windows Hello Face in Windows Settings for every person who should
  have a personal dashboard.
- Keep face recognition automations reversible and low-risk. Do not unlock doors
  or disarm alarms from ambient face labels alone.
- On Windows desktop apps, use the desktop interop form of
  `UserConsentVerifier` so the Hello prompt is owned by the Electron app window.
- Home Assistant should receive events like `surface_kiosk_person_recognized`,
  `surface_kiosk_dashboard_opened`, and `surface_kiosk_occupancy_changed`; it
  should not receive raw biometric data.

## References

- Surface Pro 4 specs: https://support.microsoft.com/en-us/surface/models/surface-pro-4-specs-and-features
- Windows Hello face authentication: https://learn.microsoft.com/en-us/windows-hardware/design/device-experiences/windows-hello-face-authentication
- Windows Hello app APIs: https://learn.microsoft.com/en-us/windows/apps/develop/security/windows-hello
- UserConsentVerifier desktop interop: https://learn.microsoft.com/en-us/windows/apps/develop/ui/display-ui-objects
