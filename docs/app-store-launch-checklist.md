# TrackItMX App Store Launch Checklist

Use this as the final pass before submitting the iPhone app to App Review.

## Website

- [ ] `https://trackitmx.com/` loads and describes TrackItMX as ride recording, review, navigation, crew visibility, and setup memory.
- [ ] `https://trackitmx.com/support/` loads and includes a working support contact.
- [ ] `https://trackitmx.com/privacy/` loads and matches the app's actual data use.
- [ ] `https://trackitmx.com/terms/` loads because the app Legal Center links to it.
- [ ] `support@trackitmx.com` is configured with MX records or forwarding and receives mail.
- [ ] `APP_STORE_URL` in `site-config.js` is filled with the live App Store listing URL after Apple provides it.
- [ ] `sitemap.xml` has been resubmitted in Google Search Console after the launch changes are live.

## App Store Connect

- [ ] App name: `TrackItMX`.
- [ ] Subtitle and description match the public app experience.
- [ ] Support URL: `https://trackitmx.com/support/`.
- [ ] Marketing URL: `https://trackitmx.com/`.
- [ ] Privacy Policy URL: `https://trackitmx.com/privacy/`.
- [ ] Privacy Choices URL, if used: `https://trackitmx.com/privacy/#your-choices`.
- [ ] App screenshots show the current product, not old beta screens.
- [ ] Review notes explain any login, anonymous account, Group Ride, spectator, Watch, CarPlay, or cloud-backed flows App Review should test.
- [ ] If any feature requires seeded data, provide exact test steps or a demo account.
- [ ] App privacy answers match the privacy policy: location, user ID or anonymous ID, ride telemetry, optional health-related data, diagnostics, analytics, support messages, and shared content where applicable.

## App Build

- [ ] Release build number is higher than the last submitted build.
- [ ] Version number is the intended public version.
- [ ] App icon and Watch icon are final.
- [ ] Launch screen is acceptable on real devices.
- [ ] Location permission prompts are plain-language and match actual use.
- [ ] HealthKit permission prompts are present if the iPhone app requests Health access.
- [ ] Background location behavior is tested with the phone locked.
- [ ] Watch companion install, permission, and ride handoff are tested.
- [ ] CarPlay route behavior is tested on a real CarPlay environment if CarPlay is included in the submission.
- [ ] Universal links work for `/join/`, `/group-ride/join/`, `/group-ride/live/`, and `/place/`.
- [ ] Shared ride web links load `/ride/` correctly for people without the app.
- [ ] Shared ride and spectator pages do not expose private information beyond what the rider intentionally shares.

## User Content And Moderation

- [ ] Public Trail Board and Ride Buddy flows have report controls.
- [ ] Public/community features have a way to block or hide abusive users if they are enabled for App Store launch.
- [ ] There is a working review/removal path for reported posts or plans.
- [ ] Terms explain content rules and support can receive abuse reports.

## Safety Position

- [ ] App and website say TrackItMX is not emergency rescue infrastructure.
- [ ] Coach, mechanic, setup, and navigation language stays informational and avoids safety guarantees.
- [ ] Offline and weak-service copy is honest: cloud-backed live, share, backup, restore, and sync features need network access.

Official Apple references:

- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- App Privacy details in App Store Connect: https://developer.apple.com/help/app-store-connect/reference/app-information/app-privacy/
- Platform version information fields: https://developer.apple.com/help/app-store-connect/reference/platform-version-information
