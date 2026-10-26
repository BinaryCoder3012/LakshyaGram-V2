# LakshyaGram

A real-time messenger for friends and classmates, with Lakshya AI one message away.

Hi, I am *Lakshya*! and my name means the aim, the target. The whole design comes from that idea. The landing page opens on a 3D archery target built in Three.js, and any message you type there flies into it as an arrow. The target's colours (blue face, gold centre, red ring) are the palette for the whole app.

## What's inside

**Landing page** (`index.html`)
- A Three.js archery target on a straw boss that you can fire messages into, with GSAP motion and scroll-linked tilt
- A tour of the app built from live HTML, a board of features, and a scroll-scrubbed "many into one" diagram
- Sign in, create account, magic link and password reset in one dialog

**The app** (`app.html`)
- Real-time one-to-one chats on Firestore, with typing indicators, read receipts and unread counts
- Replies, emoji reactions, edit, delete, copy, and stars (stars are kept on your device)
- Photos by picker, drag and drop, or paste, compressed in the browser before sending
- Pinned chats, search across chats and people (Ctrl K), and search inside a conversation
- Six chat themes saved per chat, plus light and dark mode
- Lakshya AI: a multi-turn Gemini assistant that sits in your chat list like a friend
- An Admin screen for admin accounts: people, recent conversations and broadcasts to everyone

## Setup

1. Clone the repository.
2. Copy `firebase-config.example.js` to `firebase-config.js` and fill in your Firebase project keys and admin emails. This file is gitignored.
3. In Firebase, enable **Email/Password** and **Email link** sign-in, and create a Firestore database.
4. The chat list query needs a composite index on `chats`: `participants` (array-contains) + `updatedAt` (descending). Firestore logs a link to create it the first time the app runs.
5. Deploy `api/chat.js` on Vercel and set `GEMINI_API_KEY`. `GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash`.
6. Serve the folder with any static server, or `firebase deploy` to Firebase Hosting.

The Firestore data shape is unchanged from V2 (`users/{uid}`, `chats/{uidA_uidB}`, `chats/{id}/messages`), so existing accounts and conversations carry over.

## Environment variables

| Name | Used by | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | `api/chat.js` | Google Gemini key for Lakshya AI |
| `GEMINI_MODEL` | `api/chat.js` | Optional model override |

## Built with

- HTML, CSS and JavaScript modules, no build step
- [Three.js](https://threejs.org) for the target, [GSAP](https://gsap.com) with ScrollTrigger for motion
- Firebase Authentication and Cloud Firestore
- Vercel serverless function for the Gemini API
- [Chillax](https://www.fontshare.com/fonts/chillax) from Fontshare

Made at BITS Pilani, Hyderabad Campus.
