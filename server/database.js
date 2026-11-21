import pg from 'pg';
import { createRequire } from 'module';

const SEEDED_USERS = [
  ['Alice', 'alice@paperlane.test'],
  ['Bob', 'bob@paperlane.test'],
  ['Carol', 'carol@paperlane.test'],
];

function migrateLegacyEmails(db) {
  if (!db) return;
  const migrate = db.prepare(
    'UPDATE users SET email = ? WHERE email = ?',
  );
  for (const [name, email] of SEEDED_USERS) {
    migrate.run(email, email.replace('@paperlane.test', '@ajaia.test'));
  }
}

export function createDatabase(dbPath = process.env.DB_PATH || 'data.db') {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString) {
    const pool = new pg.Pool({
      connectionString,
      ssl: process.env.PGSSLMODE === 'disable'
        ? false
        : { rejectUnauthorized: false },
      max: 10,
    });

    const ready = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL
        );
        CREATE TABLE IF NOT EXISTS docs (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          owner_id INTEGER NOT NULL REFERENCES users(id),
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS shares (
          doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'editor',
          PRIMARY KEY (doc_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS versions (
          id SERIAL PRIMARY KEY,
          doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          content TEXT NOT NULL,
          saved_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);

      const existing = await pool.query('SELECT id FROM users LIMIT 1');
      if (existing.rowCount === 0) {
        await pool.query('BEGIN');
        try {
          for (const [name, email] of SEEDED_USERS) {
            await pool.query(
              'INSERT INTO users(name, email) VALUES($1, $2)',
              [name, email],
            );
          }
          await pool.query('COMMIT');
        } catch (error) {
          await pool.query('ROLLBACK');
          throw error;
        }
      }
    })();

    const wait = async () => {
      await ready;
    };

    return {
      async close() {
        await pool.end();
      },

      async listUsers() {
        await wait();
        return (await pool.query('SELECT * FROM users')).rows;
      },

      async getUserById(id) {
        await wait();
        return (await pool.query('SELECT * FROM users WHERE id = $1', [id])).rows[0];
      },

      async getUserByEmail(email) {
        await wait();
        return (await pool.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
      },

      async listDocuments(userId) {
        await wait();
        const result = await pool.query(`
          SELECT d.id, d.title, d.updated_at, u.name AS owner_name,
            CASE WHEN d.owner_id = $1 THEN 'owner' ELSE 'shared' END AS role,
            CASE WHEN d.owner_id = $1 THEN 'editor' ELSE s.role END AS access
          FROM docs d
          JOIN users u ON u.id = d.owner_id
          LEFT JOIN shares s ON s.doc_id = d.id AND s.user_id = $1
          WHERE d.owner_id = $1 OR s.user_id = $1
          ORDER BY d.updated_at DESC
        `, [userId]);
        return result.rows;
      },

      async getDocumentAccess(documentId, userId) {
        await wait();
        const result = await pool.query(`
          SELECT d.*, u.name AS owner_name
          FROM docs d
          JOIN users u ON u.id = d.owner_id
          WHERE d.id = $1
        `, [documentId]);
        const doc = result.rows[0];
        if (!doc) return null;
        if (doc.owner_id === userId) return { doc, role: 'owner' };

        const share = await pool.query(
          'SELECT role FROM shares WHERE doc_id = $1 AND user_id = $2',
          [documentId, userId],
        );
        return share.rows[0] ? { doc, role: share.rows[0].role } : null;
      },

      async listShares(documentId) {
        await wait();
        const result = await pool.query(`
          SELECT u.id, u.name, u.email, s.role
          FROM shares s
          JOIN users u ON u.id = s.user_id
          WHERE s.doc_id = $1
        `, [documentId]);
        return result.rows;
      },

      async createDocument(title, content, ownerId, updatedAt) {
        await wait();
        const result = await pool.query(`
          INSERT INTO docs(title, content, owner_id, updated_at)
          VALUES($1, $2, $3, $4)
          RETURNING *
        `, [title, content, ownerId, updatedAt]);
        return result.rows[0];
      },

      async updateDocument(documentId, title, content, updatedAt) {
        await wait();
        await pool.query(`
          UPDATE docs SET title = $1, content = $2, updated_at = $3
          WHERE id = $4
        `, [title, content, updatedAt, documentId]);
      },

      async upsertShare(documentId, userId, role) {
        await wait();
        await pool.query(`
          INSERT INTO shares(doc_id, user_id, role)
          VALUES($1, $2, $3)
          ON CONFLICT(doc_id, user_id) DO UPDATE SET role = EXCLUDED.role
        `, [documentId, userId, role]);
      },

      async deleteShare(documentId, userId) {
        await wait();
        await pool.query(
          'DELETE FROM shares WHERE doc_id = $1 AND user_id = $2',
          [documentId, userId],
        );
      },

      async listVersions(documentId) {
        await wait();
        return (await pool.query(`
          SELECT id, title, saved_at FROM versions
          WHERE doc_id = $1 ORDER BY id DESC
        `, [documentId])).rows;
      },

      async getVersion(documentId, versionId) {
        await wait();
        return (await pool.query(
          'SELECT * FROM versions WHERE id = $1 AND doc_id = $2',
          [versionId, documentId],
        )).rows[0];
      },

      async getLatestVersion(documentId) {
        await wait();
        return (await pool.query(`
          SELECT created_at FROM versions
          WHERE doc_id = $1 ORDER BY id DESC LIMIT 1
        `, [documentId])).rows[0];
      },

      async saveVersion(doc, createdAt, keep = 30) {
        await wait();
        await pool.query('BEGIN');
        try {
          await pool.query(`
            INSERT INTO versions(doc_id, title, content, saved_at, created_at)
            VALUES($1, $2, $3, $4, $5)
          `, [doc.id, doc.title, doc.content, doc.updated_at, createdAt]);
          await pool.query(`
            DELETE FROM versions
            WHERE doc_id = $1
              AND id NOT IN (
                SELECT id FROM versions WHERE doc_id = $1
                ORDER BY id DESC LIMIT $2
              )
          `, [doc.id, keep]);
          await pool.query('COMMIT');
        } catch (error) {
          await pool.query('ROLLBACK');
          throw error;
        }
      },
    };
  }

  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS docs(id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', owner_id INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions(id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, saved_at TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shares(doc_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NOT NULL DEFAULT 'editor', PRIMARY KEY(doc_id,user_id));
  `.replace('role TEXT NOT NOT NULL', 'role TEXT NOT NULL'));

  const shareColumns = db.pragma('table_info(shares)');
  if (!shareColumns.some((column) => column.name === 'role')) {
    db.exec("ALTER TABLE shares ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'");
  }

  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const insert = db.prepare('INSERT INTO users(name,email) VALUES(?,?)');
    const seed = db.transaction(() => {
      for (const [name, email] of SEEDED_USERS) insert.run(name, email);
    });
    seed();
  }
  migrateLegacyEmails(db);

  const statements = {
    getUserById: db.prepare('SELECT * FROM users WHERE id=?'),
    getUserByEmail: db.prepare('SELECT * FROM users WHERE email=?'),
    listUsers: db.prepare('SELECT * FROM users'),
    listDocuments: db.prepare(`
      SELECT d.id,d.title,d.updated_at,u.name AS owner_name,
        CASE WHEN d.owner_id=@u THEN 'owner' ELSE 'shared' END AS role,
        CASE WHEN d.owner_id=@u THEN 'editor' ELSE s.role END AS access
      FROM docs d JOIN users u ON u.id=d.owner_id
      LEFT JOIN shares s ON s.doc_id=d.id AND s.user_id=@u
      WHERE d.owner_id=@u OR s.user_id=@u ORDER BY d.updated_at DESC
    `),
    getDocument: db.prepare('SELECT d.*,u.name AS owner_name FROM docs d JOIN users u ON u.id=d.owner_id WHERE d.id=?'),
    getShare: db.prepare('SELECT role FROM shares WHERE doc_id=? AND user_id=?'),
    listShares: db.prepare('SELECT u.id,u.name,u.email,s.role FROM shares s JOIN users u ON u.id=s.user_id WHERE s.doc_id=?'),
    insertDocument: db.prepare('INSERT INTO docs(title,content,owner_id,updated_at) VALUES(?,?,?,?)'),
    getDocumentById: db.prepare('SELECT * FROM docs WHERE id=?'),
    updateDocument: db.prepare('UPDATE docs SET title=?,content=?,updated_at=? WHERE id=?'),
    upsertShare: db.prepare('INSERT INTO shares(doc_id,user_id,role) VALUES(?,?,?) ON CONFLICT(doc_id,user_id) DO UPDATE SET role=excluded.role'),
    deleteShare: db.prepare('DELETE FROM shares WHERE doc_id=? AND user_id=?'),
    listVersions: db.prepare('SELECT id,title,saved_at FROM versions WHERE doc_id=? ORDER BY id DESC'),
    getVersion: db.prepare('SELECT * FROM versions WHERE id=? AND doc_id=?'),
    getLatestVersion: db.prepare('SELECT created_at FROM versions WHERE doc_id=? ORDER BY id DESC LIMIT 1'),
    insertVersion: db.prepare('INSERT INTO versions(doc_id,title,content,saved_at,created_at) VALUES(?,?,?,?,?)'),
    pruneVersions: db.prepare('DELETE FROM versions WHERE doc_id=? AND id NOT IN (SELECT id FROM versions WHERE doc_id=? ORDER BY id DESC LIMIT ?)'),
  };

  return {
    close: () => db.close(),
    listUsers: async () => statements.listUsers.all(),
    getUserById: async (id) => statements.getUserById.get(id),
    getUserByEmail: async (email) => statements.getUserByEmail.get(email),
    listDocuments: async (userId) => statements.listDocuments.all({ u: userId }),
    getDocumentAccess: async (documentId, userId) => {
      const doc = statements.getDocument.get(documentId);
      if (!doc) return null;
      if (doc.owner_id === userId) return { doc, role: 'owner' };
      const share = statements.getShare.get(documentId, userId);
      return share ? { doc, role: share.role } : null;
    },
    listShares: async (documentId) => statements.listShares.all(documentId),
    createDocument: async (title, content, ownerId, updatedAt) => {
      const result = statements.insertDocument.run(title, content, ownerId, updatedAt);
      return statements.getDocumentById.get(result.lastInsertRowid);
    },
    updateDocument: async (documentId, title, content, updatedAt) =>
      statements.updateDocument.run(title, content, updatedAt, documentId),
    upsertShare: async (documentId, userId, role) =>
      statements.upsertShare.run(documentId, userId, role),
    deleteShare: async (documentId, userId) =>
      statements.deleteShare.run(documentId, userId),
    listVersions: async (documentId) => statements.listVersions.all(documentId),
    getVersion: async (documentId, versionId) =>
      statements.getVersion.get(versionId, documentId),
    getLatestVersion: async (documentId) =>
      statements.getLatestVersion.get(documentId),
    saveVersion: async (doc, createdAt, keep = 30) => {
      statements.insertVersion.run(doc.id, doc.title, doc.content, doc.updated_at, createdAt);
      statements.pruneVersions.run(doc.id, doc.id, keep);
    },
  };
}
