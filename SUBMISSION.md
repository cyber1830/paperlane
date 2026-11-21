# Submission
Everything below is in the Google Drive folder, and the app is live so you can try it without installing anything.

 # Links
Live app: (add the deployed URL here)
Walkthrough video: (add the Loom or YouTube link here; the same link is in video.txt)

# Test accounts

There is no password. On the login screen, pick one of these:

alice@paperlane.test
bob@paperlane.test
carol@paperlane.test

To see sharing work, sign in as Alice, create a document and share it with bob@paperlane.test. Then use "Switch user", sign in as Bob, and it will appear under "Shared with me". Try sharing once as "View only" and once as "Can edit" to see the difference.

# What's in the folder
server/ – Express API and SQLite storage
src/ – React frontend
test/ – automated API tests
README.md – setup, run and deploy instructions
ARCHITECTURE.md – what I prioritized and why
AI_WORKFLOW.md – how I used AI tools
video.txt – walkthrough video link
Config files (package.json, vite.config.js, index.html)

# What works
Create, rename, edit, autosave and reopen documents, with bold, italic, underline, headings and lists
Upload .txt, .md or .docx files and turn them into editable documents
Sharing by email, with owned and shared documents clearly separated
Per-person permissions: Can edit or View only, which the owner can change or remove at any time
Version history with preview and restore
Export to Markdown, and to PDF through the browser's print dialog
Presence avatars showing who else has the document open
Documents, sharing and versions persist across refreshes.

# What's incomplete or limited
Login is mocked, so it's fine for a demo but not secure.
Edits are last-write-wins. Presence shows who is in the document, but changes aren't merged live, so two people typing at once can overwrite each other.
Formatting uses the browser's execCommand, which is deprecated but works everywhere.
PDF import isn't supported, and Markdown import only handles headings, bullets and paragraphs.
No commenting or suggestion mode.
The free Render deployment may lose SQLite data when the instance is redeployed or recreated; paid persistent disk or an external database is required for durable production persistence.

# What I'd build next with another 2-4 hours
Move the editor to Tiptap for better formatting control and cleaner undo.
Real authentication.
Live sync so concurrent edits merge instead of overwriting.
Comments on selected text.
Named versions, with who made each change.