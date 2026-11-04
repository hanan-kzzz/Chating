# QuietRoom — private anonymous chat

A small, mobile-friendly, invite-only chat-room starter. It uses Node.js, Express and Socket.IO.

## Features

- Temporary generated nicknames; no account or profile.
- Private rooms created with an 8–64 character passcode.
- Invite link plus passcode sharing.
- Up to 8 participants per room; rooms expire after 6 hours.
- Live messages with a 500-character limit.
- Basic contact-detail/link filtering, message rate limits and a small room-creation limit.
- Participant reporting, local message hiding (block), moderator removal and room closure.
- No public room directory, direct messages, file uploads or persistent message history.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000` on your device or computer.

## Deploy on Render

1. Create a GitHub repository and upload this project.
2. In Render, create a **Web Service** connected to that repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Use Node 20 or newer.
6. Deploy. Render supplies the `PORT` environment variable automatically.

For a real public launch, use HTTPS and review the production checklist below.

## Important limitations and safety notes

This is a starter implementation, not a fully moderated production service.

- Room state and messages live in server memory. They disappear when the server restarts or the service sleeps.
- Reports are sent to a connected room moderator, if one is present. They are not reviewed by a central trust-and-safety team.
- The content filter is deliberately basic and can miss harmful content or block harmless content.
- Blocking hides that participant's messages only in the current browser session; it does not remove them from the room.
- The moderator key is held in the creator's browser tab. If that tab is closed or refreshed, moderator access may be lost.
- Do not use this demo for sensitive conversations. Do not share addresses, phone numbers, school details, passwords, photos, or other identifying information.
- Share room links and passcodes only with people you know and trust. Anyone with both can enter while the room is active.

## Before a public launch

Add persistent, privacy-reviewed moderation/report handling; stronger abuse detection and human review; secure moderator recovery; CAPTCHA or equivalent abuse controls; a clear privacy notice and community rules; operational monitoring; and a tested process for responding to safety reports. Consider age-appropriate access controls and avoid public/random matching for a service that may be used by minors.