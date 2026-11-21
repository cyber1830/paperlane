# Architecture note

# What I set out to build

With a few hours and a deliberately open brief, I wanted one complete path that actually works rather than many half-finished screens. That path is: create or import a document, edit it with basic formatting, have it save on its own, share it with someone else, and find everything still there after a refresh. I spent my time making that loop solid and testing the parts most likely to break, which are access control and handling untrusted HTML.

 # Tech Stack and why
React + Vite for the frontend. It's fast to work in and the whole UI is a few small components.
Express for the API. It also serves the built frontend, so the whole app deploys as a single service with one URL.
SQLite (better-sqlite3). Reviewers shouldn't have to set up a database, and four small tables (users, docs, shares, versions) don't need anything heavier.

# How documents are stored

Content is saved as HTML. That keeps bold, italics, headings and lists exactly as the user made them, and it means the editor can load a document back without any conversion step. The catch is that the text comes from a contentEditable element, so I treat it as untrusted. Everything is passed through sanitize-html on the server with a short allow-list of tags and no attributes, so a script tag or an inline handler never reaches the database.

Imports follow the same rule. .txt and .md files go through a small converter (headings, bullets, paragraphs) and .docx files go through mammoth. Both results are sanitized before saving.

# Sharing and access

Every document has one owner. The owner can share it by email and pick either Can edit or View only for each person, change that later, or remove access. The check lives on the server: a viewer who tries to save gets a 403, so locking the editor in the UI is a convenience and not the only protection. Only the owner can share or revoke.

Login is mocked on purpose. There are three seeded users and the client sends a user id header. Real authentication would have taken time away from the sharing logic, which is what the exercise is really about. The tradeoff is that this is not secure for anything beyond a demo, and the README says so.

# Extras I added
Version history. When someone saves over existing content, the previous state is stored as a snapshot, at most one per minute and the latest 30 per document. Restoring a version snapshots the current state first, so a restore can be undone.

Export. Markdown is generated in the browser. PDF uses the browser's print dialog with a print stylesheet that shows only the page. It isn't a server-generated PDF, but it needs no dependency and works well enough.

Presence. The editor pings the server every few seconds, and anyone seen in the last 15 seconds shows up as an avatar. It lives in memory only.

# Tradeoffs I made on purpose
execCommand for formatting. It's deprecated, but it works in every browser and adds nothing to the bundle. If I had more time I would move to Tiptap, and the change would stay inside the Editor component.
Last write wins. Presence tells you someone else is in the document, but edits aren't merged live. Two people typing at once can overwrite each other. Real-time collaboration needs CRDTs or operational transforms, and I didn't think a rushed version would be better than an honest limitation.
Autosave on a short delay rather than on every keystroke, to keep requests down without making people feel like they might lose work.
No PDF import. The supported upload types are stated in the UI and the README.

# What I tested

The automated tests cover the riskiest logic: access before and after sharing, owner-only sharing, HTML sanitization, validation of bad input, view-only blocking, role changes and revocation, version snapshots and restore, and presence. I also went through the two-user sharing flow in the browser by hand.

# What I'd do next

Commenting, real-time sync, proper authentication, and a rich-text library. I'd also add a way to name versions and show who made each change.