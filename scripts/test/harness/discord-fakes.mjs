// Fake discord.js objects for the bot cases: an interaction that records every
// reply/update/showModal call, a client whose channels/users are plain maps, and
// a message. Nothing here touches the network; REST goes through fetch, which
// the case replaces with lib.mjs captureDiscord().
export const IDS = { owner: '738214924760907907', l3: '100000000000000003', l2: '100000000000000002', l1: '100000000000000001', et: '100000000000000009', lst: '100000000000000010', nobody: '555555555555555555' };
export const ROLES = { fm_leadership: '900000000000000001', fm_team_lead: '900000000000000002', fm_team_guide: '900000000000000003', game_affairs: '900000000000000004', founder: '900000000000000005', executive_admin: '900000000000000006' };
const NAMES = { [IDS.owner]: 'Risk (owner)', [IDS.l3]: 'Mgmt Three', [IDS.l2]: 'Lead Two', [IDS.l1]: 'Guide One', [IDS.et]: 'Event Teamer', [IDS.lst]: 'Story Lead', [IDS.nobody]: 'Random Person' };

export function fakeInteraction({ id = IDS.l3, username, globalName, displayName, roles = [], opts = {}, sub = null, customId, fields = {}, message, channel, channelId = '800000000000000001', guildId = '1457188814916423855', fromMessage = true, guildRoles = {}, channels = {}, dmFail = false } = {}) {
  const calls = [];
  const name = globalName ?? NAMES[id] ?? 'Someone';
  const rec = (n) => async (payload) => { calls.push({ name: n, payload }); return {}; };
  const client = fakeClient({ channels, users: dmFail ? new Proxy({}, { get: () => false }) : {} });
  const i = {
    user: { id, username: username ?? name.toLowerCase().replace(/\W+/g, ''), globalName: name, bot: false },
    member: { displayName: displayName ?? name, roles: { cache: new Map(roles.map(r => [r, { id: r }])) } },
    guild: { id: guildId, roles: { cache: new Map(Object.entries(guildRoles).map(([k, v]) => [k, { name: v }])) } },
    guildId, channelId, client, dms: client.dms,
    channel: channel ?? { id: channelId, name: 'test-channel', isThread: () => false, messages: { fetch: async () => new Map() } },
    customId,
    message: message ?? { content: 'original ping', components: [], embeds: [] },
    replied: false, deferred: false,
    options: {
      getString: (k) => opts[k] ?? null, getInteger: (k) => opts[k] ?? null, getUser: (k) => opts[k] ?? null,
      getRole: (k) => opts[k] ?? null, getChannel: (k) => opts[k] ?? null,
      getSubcommand: () => sub, getFocused: () => opts.__focused ?? '',
    },
    fields: { getTextInputValue: (k) => fields[k] ?? '' },
    isFromMessage: () => fromMessage,
    reply: async (p) => { calls.push({ name: 'reply', payload: p }); i.replied = true; return {}; },
    deferReply: async (p) => { calls.push({ name: 'deferReply', payload: p }); i.deferred = true; },
    editReply: rec('editReply'), followUp: rec('followUp'), showModal: rec('showModal'), update: rec('update'), respond: rec('respond'),
    calls,
  };
  return i;
}
/** The last recorded call, flattened to "<name>: <content or embed title or modal id>", with [ephemeral] when set. */
export function lastText(i) {
  const c = i.calls[i.calls.length - 1]; const p = c?.payload;
  const body = typeof p === 'string' ? p : (p?.content || (p?.embeds ? 'embed:' + (p.embeds[0]?.data?.title || p.embeds[0]?.title || '') : '') || (p?.customId ? 'modal:' + p.customId : JSON.stringify(p)?.slice(0, 120)));
  return `${c?.name}: ${body}${p?.ephemeral ? ' [ephemeral]' : ''}`;
}
export const callOf = (i, name) => i.calls.find(c => c.name === name)?.payload;
export const replyText = (i) => callOf(i, 'reply')?.content || '';

export function fakeMessage({ id, content = '', authorId = IDS.l1, bot = false, ts = Date.now(), embeds = [] } = {}) {
  return { id: id ?? String(ts), content, embeds, createdTimestamp: ts, createdAt: new Date(ts), author: { id: authorId, bot, username: 'u' + authorId.slice(-2), displayName: 'U' + authorId.slice(-2) }, delete: async () => {} };
}

export function fakeClient({ channels = {}, users = {} } = {}) {
  const sent = [], dms = [];
  const mk = (id) => {
    const c = channels[id]; if (!c) return null;
    return {
      id, name: c.name || 'chan', isTextBased: () => true, isThread: () => !!c.thread, parentId: c.parentId,
      send: async (p) => { sent.push({ channel: id, ...p }); return { id: 'sent' + sent.length }; },
      messages: { fetch: async (opts) => { const list = typeof c.messages === 'function' ? c.messages(opts) : (c.messages || []); return new Map(list.map(m => [m.id, m])); } },
      bulkDelete: async (coll) => coll,
      threads: { fetchActive: async () => ({ threads: new Map() }), fetchArchived: async () => ({ threads: new Map() }) },
    };
  };
  return {
    user: { id: 'bot000' }, sent, dms,
    channels: { fetch: async (id) => { const c = mk(id); if (!c) throw new Error(`Unknown Channel ${id}`); return c; } },
    users: { fetch: async (id) => { if (users[id] === false) throw new Error('Unknown User'); return { id, send: async (m) => { dms.push({ to: id, m }); } }; } },
  };
}
