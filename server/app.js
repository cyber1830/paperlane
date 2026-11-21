import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import sanitizeHtml from 'sanitize-html';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createDatabase } from './database.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SAFE = {
  allowedTags: [
    'p',
    'h1',
    'h2',
    'h3',
    'b',
    'strong',
    'i',
    'em',
    'u',
    'ul',
    'ol',
    'li',
    'br',
    'div',
    'span',
  ],
  allowedAttributes: {},
};

const clean = (html) => sanitizeHtml(String(html ?? ''), SAFE);
const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Minimal .txt/.md -> HTML: headings, bullets, paragraphs.
export function textToHtml(text) {
  let html = '';
  let inList = false;

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const heading = line.match(/^(#{1,3})\s+(.*)/);
    const listItem = line.match(/^[-*]\s+(.*)/);

    if (listItem) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += `<li>${escapeHtml(listItem[1])}</li>`;
      continue;
    }

    if (inList) {
      html += '</ul>';
      inList = false;
    }

    if (heading) {
      html += `<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`;
    } else if (line) {
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }

  return html + (inList ? '</ul>' : '');
}

export function createApp(dbPath = process.env.DB_PATH || 'data.db') {
  const store = createDatabase(dbPath);
  const app = express();
  const presence = new Map();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
  });

  app.use(express.json({ limit: '2mb' }));

  app.get('/api/users', (_req, res) => {
    res.json(store.listUsers());
  });

  // Mocked auth: the client sends x-user-id (seeded accounts only; see README).
  app.use('/api', (req, res, next) => {
    req.user = store.getUserById(req.get('x-user-id'));
    if (req.user) {
      next();
    } else {
      res.status(401).json({ error: 'Not signed in' });
    }
  });

  const guard = (req, res, next) => {
    const access = store.getDocumentAccess(req.params.id, req.user.id);
    if (!access) {
      return res.status(404).json({ error: 'Document not found' });
    }

    Object.assign(req, access);
    next();
  };

  const createDocument = (title, content, userId) =>
    store.createDocument(title, clean(content), userId, new Date().toISOString());

  const snapshot = (doc, force = false) => {
    const snapshotIntervalMs = 60_000;
    const keepVersions = 30;
    if (!doc.content) {
      return;
    }

    const latest = store.getLatestVersion(doc.id);
    if (
      !force &&
      latest &&
      Date.now() - new Date(latest.created_at).getTime() < snapshotIntervalMs
    ) {
      return;
    }

    store.saveVersion(doc, new Date().toISOString(), keepVersions);
  };

  app.get('/api/docs', (req, res) => {
    res.json(store.listDocuments(req.user.id));
  });

  app.post('/api/docs', (req, res) => {
    const title = String(req.body.title || 'Untitled document')
      .trim()
      .slice(0, 200);
    res.status(201).json(createDocument(title, '', req.user.id));
  });

  app.get('/api/docs/:id', guard, (req, res) => {
    const sharedWith =
      req.role === 'owner' ? store.listShares(req.doc.id) : [];
    res.json({ ...req.doc, role: req.role, shared_with: sharedWith });
  });

  app.put('/api/docs/:id', guard, (req, res) => {
    if (req.role === 'viewer') {
      return res.status(403).json({ error: 'You have view-only access' });
    }

    const { title, content } = req.body;
    if (title !== undefined && !String(title).trim()) {
      return res.status(400).json({ error: 'Title cannot be empty' });
    }
    if (content !== undefined && typeof content !== 'string') {
      return res.status(400).json({ error: 'Content must be HTML string' });
    }

    const safeContent = content !== undefined ? clean(content) : req.doc.content;
    if (content !== undefined && safeContent !== req.doc.content) {
      snapshot(req.doc);
    }

    store.updateDocument(
      req.doc.id,
      title !== undefined ? String(title).trim().slice(0, 200) : req.doc.title,
      safeContent,
      new Date().toISOString(),
    );
    res.json({ ok: true });
  });

  app.post('/api/docs/:id/share', guard, (req, res) => {
    if (req.role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can share' });
    }

    const target = store.getUserByEmail(
      String(req.body.email || '').trim().toLowerCase(),
    );
    if (!target) {
      return res.status(404).json({ error: 'No user with that email' });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ error: 'You already own this document' });
    }

    const role = req.body.role ?? 'editor';
    if (!['editor', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Role must be editor or viewer' });
    }

    store.upsertShare(req.doc.id, target.id, role);
    res.json({ id: target.id, name: target.name, email: target.email, role });
  });

  app.delete('/api/docs/:id/share/:userId', guard, (req, res) => {
    if (req.role !== 'owner') {
      return res.status(403).json({ error: 'Only the owner can remove access' });
    }

    store.deleteShare(req.doc.id, req.params.userId);
    res.json({ ok: true });
  });

  app.get('/api/docs/:id/versions', guard, (req, res) => {
    res.json(store.listVersions(req.doc.id));
  });

  app.get('/api/docs/:id/versions/:vid', guard, (req, res) => {
    const version = store.getVersion(req.doc.id, req.params.vid);
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }
    res.json(version);
  });

  app.post('/api/docs/:id/versions/:vid/restore', guard, (req, res) => {
    if (req.role === 'viewer') {
      return res.status(403).json({ error: 'You have view-only access' });
    }

    const version = store.getVersion(req.doc.id, req.params.vid);
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    snapshot(req.doc, true);
    const updatedAt = new Date().toISOString();
    store.updateDocument(
      req.doc.id,
      version.title,
      version.content,
      updatedAt,
    );
    res.json({ title: version.title, content: version.content });
  });

  // Clients ping periodically; users seen in the last 15 seconds count as present.
  app.post('/api/docs/:id/presence', guard, (req, res) => {
    const room = presence.get(req.doc.id) ?? new Map();
    presence.set(req.doc.id, room);

    const now = Date.now();
    room.set(req.user.id, { name: req.user.name, at: now });
    const others = [...room]
      .filter(([id, person]) => id !== req.user.id && now - person.at < 15_000)
      .map(([id, person]) => ({ id, name: person.name }));

    res.json(others);
  });

  app.post('/api/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const extension = path.extname(req.file.originalname).toLowerCase();
    try {
      let html;
      if (extension === '.txt' || extension === '.md') {
        html = textToHtml(req.file.buffer.toString('utf8'));
      } else if (extension === '.docx') {
        html = (
          await mammoth.convertToHtml({ buffer: req.file.buffer })
        ).value;
      } else {
        return res
          .status(400)
          .json({ error: 'Unsupported file type. Use .txt, .md or .docx' });
      }

      const title = path.basename(req.file.originalname, extension);
      res.status(201).json(createDocument(title, html, req.user.id));
    } catch {
      res.status(422).json({ error: 'Could not read that file' });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const dist = path.join(here, '..', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  return app;
}
