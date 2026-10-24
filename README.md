# CivicPulse

**A campus issue tracker for any small community or college.** Students and staff report problems (broken lights, leaking pipes, damaged walls), and everyone can see on a live heatmap where the campus needs fixing most.

> Demo project. All data lives in the browser's memory and resets when you reload the page. Nothing is sent to a server.

## Features

- **Campus heatmap**: an aerial map of the campus with a heat overlay and numbered pins. Red marks urgent areas, yellow moderate, and green means fixed. Zoom and drag to explore, or filter by category.
- **Hotspot ranking**: departments and blocks ranked by how many reports are open and how long they've waited.
- **Report an issue**: pick a category (Electrical, Water, Infrastructure) and a location, describe the problem, and attach evidence by uploading a photo, drag and drop, or using the camera. Sample photos are included for demos. Mark a report as urgent if it's a safety risk.
- **Track my reports**: every report gets a ticket ID (for example `CP-1002`). Look one up, or see all the reports you've filed, with a status of Reported, Assigned, In progress or Resolved.
- **Accounts**: sign in or create an account to report and track issues. Browsing the map needs no account.
- **Light and dark themes**, and a layout that works on phones.

## Try it

No install or build step. It's a single HTML file.

1. Download `index.html`.
2. Open it in any modern browser (Chrome, Edge, Firefox, Safari).

**Demo login:** `demo@rvce.edu.in` / `demo1234`

Camera capture needs a browser that allows camera access. If it isn't available, the app falls back to a simulated snapshot.

## How to use it

1. Open **Campus heatmap** and tap a numbered pin to see the reports for that block.
2. Choose **Report an issue**, sign in, fill in the form and submit.
3. You're taken to **Track my reports**, where your ticket appears. Use "Advance status (demo)" to step it through the stages and watch the map turn from red to green.

## Built with

Plain HTML, CSS and JavaScript. No frameworks or dependencies. The map uses an embedded campus image with a canvas heat layer.

## Limitations and next steps

- No backend: reports, accounts and photos are not saved between sessions.
- Passwords are stored in plain text in memory, for demo purposes only.
- Status changes are simulated by a button rather than by an admin.
- Ideas: a database and real authentication, an admin dashboard to verify and assign reports, real GPS location, and email or push notifications on status changes.

## Team

*Add your names, course and college here.*
