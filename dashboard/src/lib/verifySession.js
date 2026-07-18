import crypto from 'crypto';

const SECRET = process.env.SESSION_SECRET || 'fallback';
const DAYS   = 3;

export function createVerifySession(discordId, discordName) {
  const payload = Buffer.from(JSON.stringify({
    discord_id:   discordId,
    discord_name: discordName,
    exp:          Date.now() + DAYS * 86400000,
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function validateVerifySession(token) {
  if (!token) return null;
  try {
    const dot = token.lastIndexOf('.');
    const payload = token.slice(0, dot);
    const sig     = token.slice(dot + 1);
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    if (sig !== expected) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}
