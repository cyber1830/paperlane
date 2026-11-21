import Database from 'better-sqlite3';

const SEEDED_USERS = [
  ['Alice', 'alice@paperlane.test'],
  ['Bob', 'bob@paperlane.test'],
  ['Carol', 'carol@paperlane.test'],
];

function initializeDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS docs (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      owner_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY,
      doc_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shares (
      doc_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      PRIMARY KEY (doc_id, user_id)
    );
  `);

  const shareColumns = db.pragma('table_info(shares)');
  if (!shareColumns.some((column) => column.name === 'role')) {
    db.exec("ALTER TABLE shares ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'");
  }

  const migrateDemoEmail = db.prepare(
    'UPDATE users SET email = ? WHERE email = ?',
  );
  for (const [name, email] of SEEDED_USERS) {
    migrateDemoEmail.run(email, email.replace('@paperlane.test', '@ajaia.test'));
  }

  const hasUsers = db.prepare('SELECT 1 FROM users LIMIT 1').get();
  if (!hasUsers) {
    const insertUser = db.prepare('INSERT INTO users(name, email) VALUES(?, ?)');
    const seedUsers = db.transaction(() => {
      for (const [name, email] of SEEDED_USERS) {
        insertUser.run(name, email);
      }
    });
    seedUsers();
  }
}

export function createDatabase(dbPath = process.env.DB_PATH || 'data.db') {
  const db = new Database(dbPath);
  initializeDatabase(db);

  const statements = {
    getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    getUserByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    listUsers: db.prepare('SELECT * FROM users'),
    listDocuments: db.prepare(`
      SELECT
        d.id,
        d.title,
        d.updated_at,
        u.name AS owner_name,
        CASE WHEN d.owner_id = @userId THEN 'owner' ELSE 'shared' END AS role,
        CASE WHEN d.owner_id = @userId THEN 'editor' ELSE s.role END AS access
      FROM docs d
      JOIN users u ON u.id = d.owner_id
      LEFT JOIN shares s ON s.doc_id = d.id AND s.user_id = @userId
      WHERE d.owner_id = @userId OR s.user_id = @userId
      ORDER BY d.updated_at DESC
    `),
    getDocument: db.prepare(`
      SELECT d.*, u.name AS owner_name
      FROM docs d
      JOIN users u ON u.id = d.owner_id
      WHERE d.id = ?
    `),
    getShare: db.prepare(
      'SELECT role FROM shares WHERE doc_id = ? AND user_id = ?',
    ),
    listShares: db.prepare(`
      SELECT u.id, u.name, u.email, s.role
      FROM shares s
      JOIN users u ON u.id = s.user_id
      WHERE s.doc_id = ?
    `),
    insertDocument: db.prepare(`
      INSERT INTO docs(title, content, owner_id, updated_at)
      VALUES(?, ?, ?, ?)
    `),
    getDocumentById: db.prepare('SELECT * FROM docs WHERE id = ?'),
    updateDocument: db.prepare(`
      UPDATE docs
      SET title = ?, content = ?, updated_at = ?
      WHERE id = ?
    `),
    upsertShare: db.prepare(`
      INSERT INTO shares(doc_id, user_id, role)
      VALUES(?, ?, ?)
      ON CONFLICT(doc_id, user_id) DO UPDATE SET role = excluded.role
    `),
    deleteShare: db.prepare(
      'DELETE FROM shares WHERE doc_id = ? AND user_id = ?',
    ),
    listVersions: db.prepare(`
      SELECT id, title, saved_at
      FROM versions
      WHERE doc_id = ?
      ORDER BY id DESC
    `),
    getVersion: db.prepare(
      'SELECT * FROM versions WHERE id = ? AND doc_id = ?',
    ),
    getLatestVersion: db.prepare(`
      SELECT created_at
      FROM versions
      WHERE doc_id = ?
      ORDER BY id DESC
      LIMIT 1
    `),
    insertVersion: db.prepare(`
      INSERT INTO versions(doc_id, title, content, saved_at, created_at)
      VALUES(?, ?, ?, ?, ?)
    `),
    pruneVersions: db.prepare(`
      DELETE FROM versions
      WHERE doc_id = ?
        AND id NOT IN (
          SELECT id
          FROM versions
          WHERE doc_id = ?
          ORDER BY id DESC
          LIMIT ?
        )
    `),
  };

  const saveVersion = db.transaction((doc, createdAt, keep) => {
    statements.insertVersion.run(
      doc.id,
      doc.title,
      doc.content,
      doc.updated_at,
      createdAt,
    );
    statements.pruneVersions.run(doc.id, doc.id, keep);
  });

  return {
    getUserById(id) {
      return statements.getUserById.get(id);
    },

    getUserByEmail(email) {
      return statements.getUserByEmail.get(email);
    },

    listUsers() {
      return statements.listUsers.all();
    },

    listDocuments(userId) {
      return statements.listDocuments.all({ userId });
    },

    getDocumentAccess(documentId, userId) {
      const doc = statements.getDocument.get(documentId);
      if (!doc) {
        return null;
      }
      if (doc.owner_id === userId) {
        return { doc, role: 'owner' };
      }

      const share = statements.getShare.get(documentId, userId);
      return share ? { doc, role: share.role } : null;
    },

    listShares(documentId) {
      return statements.listShares.all(documentId);
    },

    createDocument(title, content, ownerId, updatedAt) {
      const result = statements.insertDocument.run(
        title,
        content,
        ownerId,
        updatedAt,
      );
      return statements.getDocumentById.get(result.lastInsertRowid);
    },

    updateDocument(documentId, title, content, updatedAt) {
      statements.updateDocument.run(title, content, updatedAt, documentId);
    },

    upsertShare(documentId, userId, role) {
      statements.upsertShare.run(documentId, userId, role);
    },

    deleteShare(documentId, userId) {
      statements.deleteShare.run(documentId, userId);
    },

    listVersions(documentId) {
      return statements.listVersions.all(documentId);
    },

    getVersion(documentId, versionId) {
      return statements.getVersion.get(versionId, documentId);
    },

    getLatestVersion(documentId) {
      return statements.getLatestVersion.get(documentId);
    },

    saveVersion(doc, createdAt, keep = 30) {
      saveVersion(doc, createdAt, keep);
    },
  };
}
