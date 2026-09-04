NEET MOCK TEST — AUTO-LOADING WEBSITE
======================================

WHAT CHANGED FROM THE ORIGINAL FILE
------------------------------------
1. Split into three files: index.html, style.css, script.js
   (kept as one folder so it still behaves as a single website).
2. All tests now load automatically for every visitor. There is no
   "choose folder" button anymore — nobody has to pick a folder on
   their own device to see tests.
3. Landing page now shows ONLY institute names. A visitor picks an
   institute, then sees that institute's tests, then starts one.

HOW AUTO-LOADING WORKS
------------------------
On page load, script.js:
  1. Fetches tests/manifest.json — a flat list of every paper.
  2. Fetches each .txt paper listed in the manifest, in parallel.
  3. Merges everything into the test library shown to visitors.
  4. Caches a successful load in the visitor's browser (IndexedDB),
     so if their connection drops on a later visit, they still see
     the last-known list instead of a blank page.
One bad or missing file is skipped quietly — it never breaks the
rest of the site.

A small test is also bundled directly inside script.js
(BUNDLED_LIBRARY) so the site still shows at least one test even if
it's opened as a local file (fetch() doesn't work over file://) or
if tests/manifest.json is ever missing.

HOW TO ADD A NEW INSTITUTE OR TEST
-------------------------------------
1. Add a plain-text paper under tests/<Institute>/<Series>/, e.g.:
     tests/Aakash/NEET Crash Course/Full Test 04.txt
   Format (same as before):
     1. Question text
     A) Option
     B) Option
     C) Option
     D) Option
     Image: <optional URL or data-URI, on its own line>
     Answer: A

     2. Next question...

2. Add one entry to tests/manifest.json:
     {
       "institute": "Aakash",
       "series": "NEET Crash Course",
       "title": "Full Test 04",
       "file": "Aakash/NEET Crash Course/Full Test 04.txt",
       "pdf": "https://drive.google.com/file/d/YOUR_FILE_ID/view"
     }
   The "pdf" field is optional. If present, a "Download PDF" button
   appears on that test's card (opens the link in a new tab). If
   omitted, only "Start test" shows — no button breaks if it's left
   out.
   Make sure the Google Drive file's sharing is set to "Anyone with
   the link" (Viewer), otherwise visitors will hit a permission error
   when they click Download PDF.

3. Upload the updated files to your web server. Every visitor sees
   the new institute/test automatically on their next page load —
   nothing to install or configure on their end.

HOSTING NOTE (IMPORTANT)
---------------------------
The automatic fetch() calls only work when the site is served over
HTTP/HTTPS (e.g. Nginx, Apache, Netlify, GitHub Pages, S3+CloudFront,
Vercel, or `python3 -m http.server`). Opening index.html by double-
clicking it (file:// in the address bar) blocks fetch() in most
browsers — in that case only the one bundled test will show. Any
ordinary static-file host works fine.

MULTIPLE USERS TAKING TESTS AT THE SAME TIME
-----------------------------------------------
This site has no backend and no shared server-side state — it is a
static set of files (HTML/CSS/JS) plus plain-text question files.
Every visitor's browser downloads its own private copy and keeps its
own quiz state (current question, answers, timer, score) entirely in
that browser tab's memory. Nobody's session can read, overwrite, or
interfere with anyone else's, no matter how many people are testing
at once — this is the same model used by any static website, and it
scales to as many concurrent visitors as your web host allows.

A few extra safeguards were added on top of that for robustness:
  - The countdown timer is always cleared before a new one starts,
    so a double-click or a slow tap can never leave two timers
    running against one visitor's own test.
  - Submitting a test (manually or via time-up) is guarded so it can
    only run once per attempt, even if both happen at nearly the
    same moment.
  - "Start test" is disabled the instant it's clicked, so a fast
    double-click can't launch the same test twice.
  - A single malformed or unreachable test file is skipped instead
    of breaking the whole test library for everyone.

FILES
------
index.html            Page structure (institute picker, test picker,
                       quiz screen, result screen)
style.css              All styling (light/dark theme included)
script.js               All behavior: auto-loading, quiz logic,
                       timer, scoring, review, print-to-PDF
tests/manifest.json     List of every auto-loaded test
tests/<Institute>/...   The plain-text paper files themselves
