/**
 * CampusBite Authentication Service
 * Static credentials and session management for Students (Clients) and Staff (Server Backoffice)
 */

const crypto = require('crypto');

// Static Users Store: 3 Students (Clients) and 1 Staff (Server Backoffice)
const USERS = [
  {
    id: 'stu-1',
    username: 'alice',
    email: 'student1@campusbite.edu',
    password: 'student123!',
    name: 'Alice Walker',
    role: 'student',
    studentId: 'STU-9021',
    avatar: 'user'
  },
  {
    id: 'stu-2',
    username: 'bob',
    email: 'student2@campusbite.edu',
    password: 'student123!',
    name: 'Bob Chen',
    role: 'student',
    studentId: 'STU-4418',
    avatar: 'user'
  },
  {
    id: 'stu-3',
    username: 'charlie',
    email: 'student3@campusbite.edu',
    password: 'student123!',
    name: 'Charlie Davis',
    role: 'student',
    studentId: 'STU-7729',
    avatar: 'user'
  },
  {
    id: 'stf-1',
    username: 'staff',
    email: 'staff@campusbite.edu',
    password: 'staff123!',
    name: 'Chef Marcus',
    role: 'staff',
    staffId: 'STF-101',
    title: 'Head of Culinary & Queue Operations',
    avatar: 'chef-hat'
  }
];

// Active sessions stored in memory: token -> { user, createdAt, expiresAt }
const sessions = new Map();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function sanitizeUser(user) {
  const { password, ...safeUser } = user;
  return safeUser;
}

/**
 * Authenticate credentials and create session
 */
function login(identifier, password) {
  if (!identifier || !password) {
    throw new Error('Username or email and password are required.');
  }

  const cleanIdentifier = String(identifier).trim().toLowerCase();
  const user = USERS.find(u => 
    u.username.toLowerCase() === cleanIdentifier || 
    u.email.toLowerCase() === cleanIdentifier
  );

  if (!user || user.password !== String(password)) {
    throw new Error('Invalid credentials. Please verify your username and password.');
  }

  const token = 'cb_' + crypto.randomBytes(24).toString('hex');
  const now = Date.now();
  const sessionData = {
    user: sanitizeUser(user),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS
  };

  sessions.set(token, sessionData);

  return {
    success: true,
    token,
    user: sanitizeUser(user)
  };
}

/**
 * Retrieve user by bearer/session token
 */
function getUserByToken(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }

  return session.user;
}

/**
 * Invalidate a session
 */
function logout(token) {
  if (token && sessions.has(token)) {
    sessions.delete(token);
    return true;
  }
  return false;
}

/**
 * Public directory of demo credentials for UI quick-login helper
 */
function getDemoCredentials() {
  return USERS.map(u => ({
    id: u.id,
    name: u.name,
    username: u.username,
    email: u.email,
    password: u.password,
    role: u.role,
    code: u.studentId || u.staffId,
    title: u.title || (u.role === 'student' ? 'Student Client' : 'Staff Backoffice')
  }));
}

module.exports = {
  login,
  getUserByToken,
  logout,
  getDemoCredentials,
  USERS
};
