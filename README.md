# Babacom — planning documents

Design and scope documents for a self-hosted, Discord-style voice, video and
screen-sharing app for a small private group split between mainland China and
Europe.

The problem it solves: Discord is blocked in mainland China, and the available
alternatives either charge for video streaming or require every user to upload
government ID. This is an invite-only replacement, self-hosted on two rented
servers, with no ID collection and no per-seat fees.

## Documents

| File | What it covers |
|---|---|
| [`scope.html`](scope.html) | Every feature selected, everything ruled out, and a three-release build order |
| [`teams.html`](teams.html) | The scope cut into 24 independently-ownable modules across eight domains, plus the shared contracts that must be frozen before parallel work starts |

Both are self-contained single files — no build step, no dependencies. Open
them directly in a browser, or serve the folder with any static file server.

## Design constraints behind these documents

The architecture is shaped by three findings from measurement and research:

1. **The Great Firewall is not the main obstacle.** It does not blanket-throttle
   UDP. Nearly all China-to-overseas packet loss is ordinary carrier congestion
   on the international backbone, worst between 20:00 and 23:00 China time.
2. **No WebRTC media server implements working video forward error correction.**
   Above roughly 6% sustained packet loss, video degrades no matter what the
   software does. Network path quality is therefore the load-bearing decision,
   not a tuning detail.
3. **Audio is recoverable where video is not.** Opus with redundancy and inband
   FEC holds up to roughly 15-22% loss, so the design is audio-first with video
   as an explicit opt-in.

The resulting shape is two servers — one in East Asia on a China-optimised
route, one in Europe — with each room pinned to a region and the region shown
in the interface.

## Publishing

These render as a static site. To serve them on GitHub Pages:
Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)`.
`index.html` links both documents.

## Status

Planning only. No application code in this repository yet.
