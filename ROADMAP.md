# Luna — feature roadmap (branch: features-v2)

Own implementation, planned from public information (store listing, own usage). No third-party code is used.

## Phone actions (Android app) — highest value
1. Open an app by name ("ইউটিউব খোলো") — Android launcher intent via a small Capacitor plugin.
2. Call a contact by name ("মাকে কল করো") — contacts lookup + dialer intent (user confirms the call).
3. Draft an SMS / WhatsApp message ("রিনাকে মেসেজ লেখো ...") — opens the compose screen prefilled; the user taps Send. Luna never sends on her own.
4. Live mode gets these as Gemini function-calling tools, so they work by voice.

## Conversation
5. Answer length style: short / detailed (setting).
6. Bengali + English code-switching tuned in prompts.
7. Memory (needs Supabase — planned later).

## Voice
8. Optional ElevenLabs voice (already built on the server path; to be added to the app's direct mode).
9. In-app setup guide (short steps to get a free Gemini key).

## Always-on
10. Notification/quick-start tile to open Live in one tap.
11. Wake word and "only my voice" (speaker check) — research needed, not guaranteed.

## Privacy rules
- Contacts are read on the device only to find the named person; nothing is uploaded.
- Microphone audio is sent to Google only while a conversation is active.
