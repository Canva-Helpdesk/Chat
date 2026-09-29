import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';
import express from 'express';
import session from 'express-session';
import { Server } from 'socket.io';

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('Stel SESSION_SECRET in voordat je de server in productie start.');
}

const database = new DatabaseSync(process.env.CHAT_DB_PATH ?? 'chat.sqlite');
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    avatar TEXT,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`);

function ensureColumn(table, column, definition) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'avatar', 'TEXT');
ensureColumn('conversation_members', 'role', "TEXT NOT NULL DEFAULT 'member'");

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    database.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        session TEXT NOT NULL,
        expires INTEGER NOT NULL
      )
    `);
  }

  get(sid, callback) {
    try {
      const row = this.database.prepare('SELECT session FROM sessions WHERE sid = ? AND expires > ?')
        .get(sid, Date.now());
      callback(null, row ? JSON.parse(row.session) : null);
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sessionData, callback) {
    try {
      const expires = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 24 * 14;
      this.database.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
      this.database.prepare(`
        INSERT INTO sessions (sid, session, expires) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET session = excluded.session, expires = excluded.expires
      `).run(sid, JSON.stringify(sessionData), expires);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  destroy(sid, callback) {
    try {
      this.database.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }

  touch(sid, sessionData, callback) {
    try {
      const expires = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 1000 * 60 * 60 * 24 * 14;
      this.database.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(expires, sid);
      callback?.(null);
    } catch (error) {
      callback?.(error);
    }
  }
}

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
const httpServer = createServer(app);
const io = new Server(httpServer);
const sessionMiddleware = session({
  store: new SQLiteSessionStore(database),
  secret: process.env.SESSION_SECRET ?? randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 14,
  },
});
const onlineSockets = new Map();

app.use(express.json({ limit: '1mb' }));
app.use(sessionMiddleware);

function publicUser(user) {
  return user ? { id: user.id, email: user.email, name: user.name, avatar: user.avatar ?? null } : null;
}

function requireUser(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Log eerst in om verder te gaan.' });
  next();
}

function establishSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.userId = userId;
      req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

function getConversationForMember(conversationId, userId) {
  return database.prepare(`
    SELECT c.id, c.title, c.invite_token AS inviteToken, c.created_by AS createdBy,
      CASE WHEN c.created_by = cm.user_id THEN 'owner' ELSE cm.role END AS myRole,
      (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) AS memberCount,
      (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS lastMessage,
      (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS lastMessageAt
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE c.id = ? AND cm.user_id = ?
  `).get(conversationId, userId);
}

function conversationPresence(conversationId) {
  const members = database.prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(conversationId);
  return members.filter(({ user_id }) => onlineSockets.has(user_id)).map(({ user_id }) => user_id);
}

function broadcastPresence(conversationId) {
  io.to(`conversation:${conversationId}`).emit('presence:update', {
    conversationId,
    onlineUserIds: conversationPresence(conversationId),
  });
}

app.get('/api/session', (req, res) => {
  const user = req.session.userId
    ? database.prepare('SELECT id, email, name, avatar FROM users WHERE id = ?').get(req.session.userId)
    : null;
  res.json({ user: publicUser(user) });
});

app.post('/api/register', async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const name = String(req.body.name ?? '').trim();
  const password = String(req.body.password ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Vul een geldig e-mailadres in.' });
  }
  if (name.length < 2 || name.length > 28) {
    return res.status(400).json({ error: 'Je naam moet 2 tot 28 tekens lang zijn.' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Kies een wachtwoord van minimaal 8 tekens.' });
  }

  try {
    const result = database.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
      .run(email, name, await bcrypt.hash(password, 12));
    await establishSession(req, Number(result.lastInsertRowid));
    res.status(201).json({ user: { id: Number(result.lastInsertRowid), email, name, avatar: null } });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Er bestaat al een account met dit e-mailadres.' });
    }
    throw error;
  }
});

app.post('/api/login', async (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');
  const user = database.prepare('SELECT id, email, name, avatar, password_hash FROM users WHERE email = ?').get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'E-mailadres of wachtwoord klopt niet.' });
  }
  await establishSession(req, user.id);
  res.json({ user: publicUser(user) });
});

app.patch('/api/profile', requireUser, async (req, res) => {
  const user = database.prepare('SELECT id, email, name, avatar, password_hash FROM users WHERE id = ?').get(req.session.userId);
  const name = String(req.body.name ?? user.name).trim();
  const avatar = req.body.avatar === undefined ? user.avatar : req.body.avatar;
  const currentPassword = String(req.body.currentPassword ?? '');
  const newPassword = String(req.body.newPassword ?? '');

  if (name.length < 2 || name.length > 28) {
    return res.status(400).json({ error: 'Je naam moet 2 tot 28 tekens lang zijn.' });
  }
  if (avatar !== null && (typeof avatar !== 'string' || avatar.length > 700_000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(avatar))) {
    return res.status(400).json({ error: 'Kies een PNG-, JPG- of WebP-afbeelding kleiner dan 500 KB.' });
  }
  if (newPassword && (newPassword.length < 8 || newPassword.length > 128)) {
    return res.status(400).json({ error: 'Kies een nieuw wachtwoord van minimaal 8 tekens.' });
  }
  if (newPassword && !(await bcrypt.compare(currentPassword, user.password_hash))) {
    return res.status(400).json({ error: 'Je huidige wachtwoord klopt niet.' });
  }

  const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : user.password_hash;
  database.prepare('UPDATE users SET name = ?, avatar = ?, password_hash = ? WHERE id = ?')
    .run(name, avatar, passwordHash, user.id);
  res.json({ user: { id: user.id, email: user.email, name, avatar } });
});

app.post('/api/logout', requireUser, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('connect.sid', { httpOnly: true, sameSite: 'lax' });
    res.status(204).end();
  });
});

app.get('/api/conversations', requireUser, (req, res) => {
  const conversations = database.prepare(`
    SELECT c.id, c.title, c.invite_token AS inviteToken, c.created_by AS createdBy,
      CASE WHEN c.created_by = cm.user_id THEN 'owner' ELSE cm.role END AS myRole,
      (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS lastMessage,
      (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS lastMessageAt,
      (SELECT COUNT(*) FROM conversation_members WHERE conversation_id = c.id) AS memberCount
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ?
    ORDER BY COALESCE(lastMessageAt, c.created_at) DESC
  `).all(req.session.userId);
  res.json({ conversations });
});

app.post('/api/conversations', requireUser, (req, res) => {
  const title = String(req.body.title ?? '').trim();
  if (title.length < 2 || title.length > 48) {
    return res.status(400).json({ error: 'De chatnaam moet 2 tot 48 tekens lang zijn.' });
  }

  const userId = req.session.userId;
  database.exec('BEGIN');
  try {
    const inviteToken = randomBytes(24).toString('base64url');
    const result = database.prepare('INSERT INTO conversations (title, created_by, invite_token) VALUES (?, ?, ?)')
      .run(title, userId, inviteToken);
    const conversationId = Number(result.lastInsertRowid);
    database.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)')
      .run(conversationId, userId);
    database.exec('COMMIT');
    res.status(201).json({ conversation: getConversationForMember(conversationId, userId) });
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
});

app.post('/api/invites/:token', requireUser, (req, res) => {
  const conversation = database.prepare('SELECT id FROM conversations WHERE invite_token = ?').get(req.params.token);
  if (!conversation) return res.status(404).json({ error: 'Deze uitnodigingslink is niet meer geldig.' });
  database.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)')
    .run(conversation.id, req.session.userId);
  res.json({ conversationId: conversation.id });
});

app.get('/api/conversations/:id/members', requireUser, (req, res) => {
  const conversationId = Number(req.params.id);
  if (!getConversationForMember(conversationId, req.session.userId)) {
    return res.status(404).json({ error: 'Chat niet gevonden.' });
  }
  const members = database.prepare(`
    SELECT u.id, u.name, u.avatar, cm.joined_at AS joinedAt,
      CASE WHEN c.created_by = u.id THEN 'owner' ELSE cm.role END AS role
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    JOIN conversations c ON c.id = cm.conversation_id
    WHERE cm.conversation_id = ?
    ORDER BY CASE WHEN c.created_by = u.id THEN 0 WHEN cm.role = 'admin' THEN 1 ELSE 2 END, u.name COLLATE NOCASE
  `).all(conversationId);
  res.json({ members });
});

app.patch('/api/conversations/:id', requireUser, (req, res) => {
  const conversationId = Number(req.params.id);
  const conversation = getConversationForMember(conversationId, req.session.userId);
  if (!conversation) return res.status(404).json({ error: 'Chat niet gevonden.' });
  if (conversation.myRole !== 'owner' && conversation.myRole !== 'admin') {
    return res.status(403).json({ error: 'Alleen de eigenaar of een beheerder kan de chat aanpassen.' });
  }
  const title = String(req.body.title ?? '').trim();
  if (title.length < 2 || title.length > 48) {
    return res.status(400).json({ error: 'De chatnaam moet 2 tot 48 tekens lang zijn.' });
  }
  database.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conversationId);
  io.to(`conversation:${conversationId}`).emit('conversation:updated', { conversationId, title });
  res.json({ conversation: getConversationForMember(conversationId, req.session.userId) });
});

app.patch('/api/conversations/:id/members/:userId', requireUser, (req, res) => {
  const conversationId = Number(req.params.id);
  const targetUserId = Number(req.params.userId);
  const conversation = getConversationForMember(conversationId, req.session.userId);
  if (!conversation) return res.status(404).json({ error: 'Chat niet gevonden.' });
  if (conversation.myRole !== 'owner') {
    return res.status(403).json({ error: 'Alleen de eigenaar kan beheerders instellen.' });
  }
  if (targetUserId === conversation.createdBy || !['admin', 'member'].includes(req.body.role)) {
    return res.status(400).json({ error: 'Deze rol kan niet worden ingesteld.' });
  }
  const result = database.prepare('UPDATE conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?')
    .run(req.body.role, conversationId, targetUserId);
  if (!result.changes) return res.status(404).json({ error: 'Lid niet gevonden.' });
  io.to(`conversation:${conversationId}`).emit('members:updated', { conversationId });
  res.json({ ok: true });
});

app.post('/api/conversations/:id/leave', requireUser, (req, res) => {
  const conversationId = Number(req.params.id);
  const conversation = getConversationForMember(conversationId, req.session.userId);
  if (!conversation) return res.status(404).json({ error: 'Chat niet gevonden.' });
  const room = `conversation:${conversationId}`;
  if (conversation.myRole === 'owner') {
    const successor = database.prepare(`
      SELECT user_id AS userId FROM conversation_members
      WHERE conversation_id = ? AND user_id != ?
      ORDER BY CASE WHEN role = 'admin' THEN 0 ELSE 1 END, joined_at, user_id
      LIMIT 1
    `).get(conversationId, req.session.userId);
    if (!successor) return res.status(409).json({ error: 'Je bent het enige lid. Verwijder de groep als je wilt stoppen.' });
    database.exec('BEGIN');
    try {
      database.prepare('UPDATE conversations SET created_by = ? WHERE id = ?').run(successor.userId, conversationId);
      database.prepare("UPDATE conversation_members SET role = 'member' WHERE conversation_id = ? AND user_id = ?")
        .run(conversationId, successor.userId);
      database.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
        .run(conversationId, req.session.userId);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    io.to(room).emit('owner:changed', { conversationId, ownerId: successor.userId });
  } else {
    database.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
      .run(conversationId, req.session.userId);
  }
  for (const socketId of onlineSockets.get(req.session.userId) ?? []) {
    io.sockets.sockets.get(socketId)?.leave(room);
  }
  io.to(room).emit('members:updated', { conversationId });
  broadcastPresence(conversationId);
  res.status(204).end();
});

app.delete('/api/conversations/:id', requireUser, (req, res) => {
  const conversationId = Number(req.params.id);
  const conversation = getConversationForMember(conversationId, req.session.userId);
  if (!conversation) return res.status(404).json({ error: 'Chat niet gevonden.' });
  if (conversation.myRole !== 'owner') {
    return res.status(403).json({ error: 'Alleen de eigenaar kan de chat verwijderen.' });
  }
  const room = `conversation:${conversationId}`;
  io.to(room).emit('conversation:deleted', { conversationId });
  io.in(room).socketsLeave(room);
  database.prepare('DELETE FROM conversations WHERE id = ?').run(conversationId);
  res.status(204).end();
});

app.post('/api/conversations/:id/invite', requireUser, (req, res) => {
  const conversationId = Number(req.params.id);
  const conversation = getConversationForMember(conversationId, req.session.userId);
  if (!conversation) return res.status(404).json({ error: 'Chat niet gevonden.' });
  if (conversation.myRole !== 'owner' && conversation.myRole !== 'admin') {
    return res.status(403).json({ error: 'Alleen de eigenaar of een beheerder kan de link vernieuwen.' });
  }
  const inviteToken = randomBytes(24).toString('base64url');
  database.prepare('UPDATE conversations SET invite_token = ? WHERE id = ?').run(inviteToken, conversationId);
  res.json({ inviteToken });
});

app.get('/api/conversations/:id/messages', requireUser, (req, res) => {
  const conversationId = Number(req.params.id);
  if (!getConversationForMember(conversationId, req.session.userId)) {
    return res.status(404).json({ error: 'Chat niet gevonden.' });
  }
  const messages = database.prepare(`
    SELECT m.id, m.conversation_id AS conversationId, m.user_id AS userId,
      u.name AS userName, u.avatar AS userAvatar, m.body, m.created_at AS createdAt
    FROM messages m JOIN users u ON u.id = m.user_id
    WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 100
  `).all(conversationId).reverse();
  res.json({ messages });
});

io.engine.use(sessionMiddleware);
io.use((socket, next) => {
  if (!socket.request.session?.userId) return next(new Error('Log eerst in.'));
  next();
});

io.on('connection', (socket) => {
  const userId = socket.request.session.userId;
  if (!onlineSockets.has(userId)) onlineSockets.set(userId, new Set());
  onlineSockets.get(userId).add(socket.id);

  socket.on('conversation:join', (rawConversationId) => {
    const conversationId = Number(rawConversationId);
    if (!getConversationForMember(conversationId, userId)) return;
    socket.join(`conversation:${conversationId}`);
    broadcastPresence(conversationId);
  });

  socket.on('message:send', (payload, acknowledge) => {
    const conversationId = Number(payload?.conversationId);
    const body = String(payload?.body ?? '').trim();
    if (body.length < 1 || body.length > 2000) {
      return acknowledge?.({ error: 'Een bericht mag maximaal 2000 tekens bevatten.' });
    }
    if (!getConversationForMember(conversationId, userId)) {
      return acknowledge?.({ error: 'Je hebt geen toegang tot deze chat.' });
    }
    const result = database.prepare('INSERT INTO messages (conversation_id, user_id, body) VALUES (?, ?, ?)')
      .run(conversationId, userId, body);
    const message = database.prepare(`
      SELECT m.id, m.conversation_id AS conversationId, m.user_id AS userId,
        u.name AS userName, u.avatar AS userAvatar, m.body, m.created_at AS createdAt
      FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?
    `).get(Number(result.lastInsertRowid));
    io.to(`conversation:${conversationId}`).emit('message:new', message);
    acknowledge?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const sockets = onlineSockets.get(userId);
    sockets?.delete(socket.id);
    if (!sockets?.size) onlineSockets.delete(userId);
    for (const room of socket.rooms) {
      if (room.startsWith('conversation:')) {
        broadcastPresence(Number(room.slice('conversation:'.length)));
      }
    }
  });

  for (const room of socket.rooms) {
    if (room.startsWith('conversation:')) broadcastPresence(Number(room.slice('conversation:'.length)));
  }
});

const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.resolve(root, '../dist')));
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'Er ging iets mis. Probeer het opnieuw.' });
});

const port = Number(process.env.PORT ?? 3001);
httpServer.listen(port, '0.0.0.0', () => {
  console.log(`Chat-server draait op http://localhost:${port}`);
});