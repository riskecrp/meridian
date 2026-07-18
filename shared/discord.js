// Discord API helper — used by both dashboard and bot
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || '';

export async function sendDiscordMessage(channelId, content, embeds = null) {
    if (!BOT_TOKEN || !channelId) {
        console.error(`[Discord] Missing token or channel ID`);
        return;
    }
    try {
        const payload = { content, allowed_mentions: { parse: ['roles', 'users'] } };
        if (embeds) payload.embeds = embeds;

        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) console.error(`[Discord] ${res.status}: ${await res.text()}`);
    } catch (e) {
        console.error('[Discord] Network error:', e.message);
    }
}

export async function fetchDiscordUser(userId) {
    if (!BOT_TOKEN || !userId || userId.length < 15) return null;
    try {
        const res = await fetch(`https://discord.com/api/v10/users/${userId}`, {
            headers: { 'Authorization': `Bot ${BOT_TOKEN}` }
        });
        if (res.ok) return await res.json();
    } catch (e) {}
    return null;
}

export async function fetchGuildMember(guildId, userId) {
    if (!BOT_TOKEN) return null;
    try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
            headers: { 'Authorization': `Bot ${BOT_TOKEN}` }
        });
        if (res.ok) return await res.json();
    } catch (e) {}
    return null;
}

export async function modifyMemberRole(guildId, userId, roleId, action = 'PUT') {
    if (!BOT_TOKEN) return false;
    try {
        const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
            method: action,
            headers: { 'Authorization': `Bot ${BOT_TOKEN}` }
        });
        return res.ok;
    } catch (e) { return false; }
}
