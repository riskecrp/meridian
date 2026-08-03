"use client";
// Admin › Records: Audit Log, Archive, Server Logs (Leadership), Conversations.
// Split out of admin/page.js — content unchanged.
import { useEffect, useMemo, useState } from "react";
import { getAuditLog, deleteAuditLogEntry, getArchivedFactions, restoreFaction, getConversationStats, generateConversationSummary, getMemberSuggestions, getAvailableChannels } from "../../../fm/operations/actions.js";
import { OWNER_ID } from "../../adminNav.js";

/* ── Audit Log (pruning is owner-only — an editable audit trail isn't one) ── */
function Audit({ auth }) {
  const isOwner = auth?.id === OWNER_ID || auth?._realId === OWNER_ID;
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const load = () => getAuditLog(200).then(r => { setRows(r || []); setLoading(false); });
  useEffect(() => { load(); }, []);
  if (loading) return <div className="empty">Loading…</div>;
  const shown = rows.filter(l => !q || [l.actor_name, l.action, l.target_type, l.target_label, l.details].some(x => (x || "").toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <input className="filter-inp" placeholder="Search actor, action, target…" value={q} onChange={e => setQ(e.target.value)} style={{ marginBottom: 14, maxWidth: 340 }} />
      <div className="card"><div style={{ overflowX: "auto" }}>
        <table className="dtable" style={{ minWidth: 720 }}>
          <thead><tr><th>Timestamp</th><th>Action</th><th>Target</th><th>Details</th><th>Actor</th>{isOwner && <th></th>}</tr></thead>
          <tbody>
            {shown.map(l => (
              <tr key={l.id}>
                <td style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{l.timestamp}</td>
                <td style={{ fontWeight: 700, whiteSpace: "nowrap", color: (l.action.includes("DELETE") || l.action === "REJECT") ? "var(--rose)" : l.action.includes("CREATE") ? "var(--good)" : "var(--accent)" }}>{l.action}</td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{l.target_type}</td>
                <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.target_label || l.details}</td>
                <td style={{ color: "var(--ink-3)", whiteSpace: "nowrap" }}>{l.actor_name}</td>
                {isOwner && <td><button className="act" style={{ padding: "2px 7px", color: "var(--rose)" }} onClick={async () => { if (window.confirm("Delete this audit entry?")) { await deleteAuditLogEntry(l.id); load(); } }}>Del</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </>
  );
}

/* ── Archive ── */
function Archive() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [exp, setExp] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { setBusy(true); const r = await getArchivedFactions().catch(() => []); setRows(r || []); setBusy(false); };
  const shown = (rows || []).filter(f => !q || [f.name, f.leadName].some(x => (x || "").toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <input className="filter-inp" placeholder="Search archived factions…" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        {rows === null && <button className="btn" disabled={busy} onClick={load}>{busy ? "Loading…" : "Load archive"}</button>}
      </div>
      {rows === null ? <div className="empty">Click “Load archive” to view historical factions.</div>
        : shown.length === 0 ? <div className="empty">No archived factions.</div> : (
          <div className="card">
            {shown.map(f => {
              const open = exp === f.id;
              return (
                <div key={f.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <div className="row" onClick={() => setExp(open ? null : f.id)}>
                    <span className="chip" style={{ background: "var(--rose-bg)", color: "var(--rose)" }}>ARCHIVED</span>
                    <span className="desc">{f.name}</span>
                    <span className="tier lo">T{f.tier}</span>
                    <span style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--v2-mono)" }}>{f.memberCount}m · {f.sceneCount}sc · {f.archived_at?.slice(0, 10)}</span>
                    <button className="act good" style={{ padding: "2px 8px" }} onClick={async e => { e.stopPropagation(); if (window.confirm(`Restore "${f.name}"?`)) { await restoreFaction(f.id); load(); } }}>Restore</button>
                    <span className="caret">▼</span>
                  </div>
                  {open && (
                    <div className="task-detail">
                      <div className="kv" style={{ paddingTop: 0 }}>
                        <div><div className="k">Last team</div><div className="v">{f.teamName || "—"}</div></div>
                        <div><div className="k">Last lead</div><div className="v">{f.leadName || "—"}</div></div>
                        <div><div className="k">Final tier</div><div className="v">T{f.tier}</div></div>
                      </div>
                      {f.members?.length > 0 && <><div className="imp-grp">Known command ({f.members.length})</div><div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{f.members.map((m, i) => <span key={i} className="chip role">{m.is_leader ? "👑 " : ""}{m.character_name}</span>)}</div></>}
                      {f.properties?.length > 0 && <><div className="imp-grp">Properties</div><div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{f.properties.map((p, i) => <span key={i} className="chip role">{p.is_hq ? "🏰 " : "📍 "}{p.address}</span>)}</div></>}
                      {f.imports?.length > 0 && <><div className="imp-grp">Authorized imports ({f.imports.length})</div><div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{f.imports.map((im, i) => <span key={i} className="chip role">T{im.tier} {im.name}</span>)}</div></>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </>
  );
}
/* ── Server Logs (Leadership): member events / deleted / edited / keyword alerts ── */
const fmtTs = (ts) => ts ? new Date(ts + "Z").toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
function UserCell({ displayName, username, userId }) {
  if (!displayName && !username) return <span style={{ color: "var(--ink-3)", fontStyle: "italic" }}>unknown</span>;
  return (
    <div>
      <div style={{ fontWeight: 600 }}>{displayName || username}</div>
      {displayName && displayName !== username && <div style={{ color: "var(--ink-3)", fontSize: 10, fontFamily: "var(--v2-mono)" }}>@{username}</div>}
      {userId && <div style={{ color: "var(--ink-3)", fontSize: 10, fontFamily: "var(--v2-mono)" }}>{userId}</div>}
    </div>
  );
}
function LogStats({ items }) {
  return <div className="metrics" style={{ marginBottom: 14, paddingBottom: 12 }}>{items.map(({ label, value, color }) => <div className="metric" key={label}><div className="l">{label}</div><div className="v" style={color ? { color } : undefined}>{value}</div></div>)}</div>;
}
function LogFilters({ search, setSearch, guild, setGuild, guilds, children }) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
      <input className="filter-inp" style={{ maxWidth: 240 }} placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
      <select className="filter-inp" style={{ maxWidth: 200 }} value={guild} onChange={e => setGuild(e.target.value)}>{guilds.map(g => <option key={g}>{g}</option>)}</select>
      {children}
    </div>
  );
}

function ServerLogs() {
  const [tab, setTab] = useState("members");
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div className="sub-tabs" style={{ padding: 0 }}>
          {[["members", "Member Events"], ["deleted", "Deleted Messages"], ["edited", "Edited Messages"], ["alerts", "⚠ Keyword Alerts"]].map(([id, l]) => (
            <button key={id} className={`tab${tab === id ? " on" : ""}`} onClick={() => setTab(id)}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize: 11, color: "var(--ink-3)" }}>All servers the bot is in · Leadership only</span>
      </div>
      {tab === "members" && <MemberEvents />}
      {tab === "deleted" && <DeletedMessages />}
      {tab === "edited" && <EditedMessages />}
      {tab === "alerts" && <KeywordAlerts />}
    </>
  );
}

function MemberEvents() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [guild, setGuild] = useState("All");
  const [event, setEvent] = useState("All");
  useEffect(() => { fetch("/api/memberlog").then(r => r.ok ? r.json() : []).then(d => { setLogs(d); setLoading(false); }).catch(() => setLoading(false)); }, []);
  const guilds = useMemo(() => ["All", ...new Set(logs.map(l => l.guild_name))].sort(), [logs]);
  const filtered = useMemo(() => logs.filter(l => {
    if (guild !== "All" && l.guild_name !== guild) return false;
    if (event !== "All" && l.event !== event) return false;
    const q = search.toLowerCase();
    return !q || l.username.toLowerCase().includes(q) || l.display_name.toLowerCase().includes(q);
  }), [logs, guild, event, search]);
  return (
    <>
      <LogStats items={[{ label: "Showing", value: filtered.length }, { label: "Joins", value: filtered.filter(l => l.event === "join").length, color: "var(--good)" }, { label: "Leaves", value: filtered.filter(l => l.event === "leave").length, color: "var(--rose)" }]} />
      <LogFilters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds}>
        <select className="filter-inp" style={{ maxWidth: 140 }} value={event} onChange={e => setEvent(e.target.value)}>
          <option>All</option><option value="join">Joins only</option><option value="leave">Leaves only</option>
        </select>
      </LogFilters>
      <div className="card"><div style={{ overflowX: "auto" }}>
        {loading ? <div className="empty">Loading…</div> : filtered.length === 0 ? <div className="empty">No events yet.</div> : (
          <table className="dtable" style={{ minWidth: 640 }}>
            <thead><tr><th>Event</th><th>Username</th><th>Display name</th><th>Server</th><th>Time</th></tr></thead>
            <tbody>{filtered.map(l => (
              <tr key={l.id}>
                <td><span className="chip" style={{ background: l.event === "join" ? "var(--good-bg)" : "var(--rose-bg)", color: l.event === "join" ? "var(--good)" : "var(--rose)" }}>{l.event === "join" ? "↗ JOIN" : "↙ LEAVE"}</span></td>
                <td style={{ fontFamily: "var(--v2-mono)", fontSize: 11.5 }}>{l.username}</td>
                <td style={{ color: "var(--ink-2)" }}>{l.display_name !== l.username ? l.display_name : "—"}</td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{l.guild_name}</td>
                <td style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{fmtTs(l.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div></div>
    </>
  );
}

function DeletedMessages() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [guild, setGuild] = useState("All");
  const [cached, setCached] = useState("All");
  useEffect(() => { fetch("/api/deletedmessages").then(r => r.ok ? r.json() : []).then(d => { setLogs(d); setLoading(false); }).catch(() => setLoading(false)); }, []);
  const guilds = useMemo(() => ["All", ...new Set(logs.map(l => l.guild_name))].sort(), [logs]);
  const filtered = useMemo(() => logs.filter(l => {
    if (guild !== "All" && l.guild_name !== guild) return false;
    if (cached === "cached" && !l.had_content) return false;
    if (cached === "uncached" && l.had_content) return false;
    const q = search.toLowerCase();
    return !q || l.author_name.toLowerCase().includes(q) || l.content.toLowerCase().includes(q) || l.channel_name.toLowerCase().includes(q);
  }), [logs, guild, cached, search]);
  return (
    <>
      <div style={{ padding: "8px 12px", borderRadius: 8, background: "var(--amber-bg)", fontSize: 12, color: "var(--amber)", marginBottom: 14 }}>⚠ Content only available for messages the bot cached since last restart.</div>
      <LogStats items={[{ label: "Showing", value: filtered.length }, { label: "With content", value: logs.filter(l => l.had_content).length, color: "var(--good)" }, { label: "No content", value: logs.filter(l => !l.had_content).length }]} />
      <LogFilters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds}>
        <select className="filter-inp" style={{ maxWidth: 180 }} value={cached} onChange={e => setCached(e.target.value)}>
          <option value="All">All messages</option><option value="cached">With content</option><option value="uncached">No content</option>
        </select>
      </LogFilters>
      <div className="card"><div style={{ overflowX: "auto" }}>
        {loading ? <div className="empty">Loading…</div> : filtered.length === 0 ? <div className="empty">No deleted messages logged yet.</div> : (
          <table className="dtable" style={{ minWidth: 820 }}>
            <thead><tr><th>Author</th><th>Deleted by</th><th>Channel</th><th>Server</th><th>Content</th><th>Time</th></tr></thead>
            <tbody>{filtered.map(l => {
              const selfDel = !l.deleter_id || l.deleter_id === l.author_id;
              return (
                <tr key={l.id}>
                  <td><UserCell displayName={l.author_display_name} username={l.author_name} userId={l.author_id} /></td>
                  <td>{selfDel ? <span style={{ color: "var(--ink-3)", fontStyle: "italic", fontSize: 11 }}>Self / unknown</span> : <div><div style={{ color: "var(--rose)", fontWeight: 600 }}>{l.deleter_name}</div><div style={{ color: "var(--ink-3)", fontSize: 10, fontFamily: "var(--v2-mono)" }}>{l.deleter_id}</div></div>}</td>
                  <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>#{l.channel_name || l.channel_id}</td>
                  <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{l.guild_name}</td>
                  <td style={{ maxWidth: 360 }}>{l.had_content ? <span style={{ lineHeight: 1.5, wordBreak: "break-word" }}>{l.content}</span> : <span style={{ color: "var(--ink-3)", fontStyle: "italic", fontSize: 11 }}>Not cached · ID {l.message_id}</span>}</td>
                  <td style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{fmtTs(l.created_at)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div></div>
    </>
  );
}

function EditedMessages() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [guild, setGuild] = useState("All");
  useEffect(() => { fetch("/api/editedmessages").then(r => r.ok ? r.json() : []).then(d => { setLogs(d); setLoading(false); }).catch(() => setLoading(false)); }, []);
  const guilds = useMemo(() => ["All", ...new Set(logs.map(l => l.guild_name))].sort(), [logs]);
  const filtered = useMemo(() => logs.filter(l => {
    if (guild !== "All" && l.guild_name !== guild) return false;
    const q = search.toLowerCase();
    return !q || l.author_name.toLowerCase().includes(q) || l.author_display_name.toLowerCase().includes(q) || l.content_before.toLowerCase().includes(q) || l.content_after.toLowerCase().includes(q);
  }), [logs, guild, search]);
  return (
    <>
      <LogStats items={[{ label: "Showing", value: filtered.length }, { label: "Total edits", value: logs.length }, { label: "Servers", value: new Set(logs.map(l => l.guild_id)).size }]} />
      <LogFilters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds} />
      <div className="card"><div style={{ overflowX: "auto" }}>
        {loading ? <div className="empty">Loading…</div> : filtered.length === 0 ? <div className="empty">No edited messages logged yet.</div> : (
          <table className="dtable" style={{ minWidth: 820 }}>
            <thead><tr><th>Author</th><th>Channel</th><th>Server</th><th>Before</th><th>After</th><th>Time</th></tr></thead>
            <tbody>{filtered.map(l => (
              <tr key={l.id}>
                <td><UserCell displayName={l.author_display_name} username={l.author_name} userId={l.author_id} /></td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>#{l.channel_name || l.channel_id}</td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{l.guild_name}</td>
                <td style={{ maxWidth: 280, color: "var(--ink-3)", lineHeight: 1.5, wordBreak: "break-word" }}>{l.content_before}</td>
                <td style={{ maxWidth: 280, lineHeight: 1.5, wordBreak: "break-word" }}>{l.content_after}</td>
                <td style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{fmtTs(l.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div></div>
    </>
  );
}

function KeywordAlerts() {
  const [keywords, setKeywords] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loadingKw, setLoadingKw] = useState(true);
  const [loadingAl, setLoadingAl] = useState(true);
  const [newPhrase, setNewPhrase] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [guild, setGuild] = useState("All");
  const loadKeywords = () => fetch("/api/keywords").then(r => r.ok ? r.json() : []).then(d => { setKeywords(d); setLoadingKw(false); }).catch(() => setLoadingKw(false));
  const loadAlerts = () => fetch("/api/keywordalerts").then(r => r.ok ? r.json() : []).then(d => { setAlerts(d); setLoadingAl(false); }).catch(() => setLoadingAl(false));
  useEffect(() => { loadKeywords(); loadAlerts(); }, []);
  const addKeyword = async () => {
    const phrase = newPhrase.trim();
    if (!phrase) return;
    setSaving(true);
    await fetch("/api/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phrase }) });
    setNewPhrase(""); setSaving(false); loadKeywords();
  };
  const removeKeyword = async (id) => { await fetch("/api/keywords", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); loadKeywords(); };
  const guilds = useMemo(() => ["All", ...new Set(alerts.map(a => a.guild_name))].sort(), [alerts]);
  const filtered = useMemo(() => alerts.filter(a => {
    if (guild !== "All" && a.guild_name !== guild) return false;
    const q = search.toLowerCase();
    return !q || a.keyword.toLowerCase().includes(q) || a.author_name.toLowerCase().includes(q) || a.content.toLowerCase().includes(q);
  }), [alerts, guild, search]);
  return (
    <>
      <div className="card">
        <div className="hd"><div className="t">Monitored phrases</div><div className="meta">{keywords.length} active</div></div>
        <div style={{ display: "flex", gap: 8, margin: "8px 0 10px" }}>
          <input className="filter-inp" style={{ flex: 1, maxWidth: 380 }} placeholder="Add keyword or phrase…" value={newPhrase} onChange={e => setNewPhrase(e.target.value)} onKeyDown={e => e.key === "Enter" && addKeyword()} />
          <button className="btn" disabled={saving || !newPhrase.trim()} onClick={addKeyword}>{saving ? "…" : "Add"}</button>
        </div>
        {loadingKw ? <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Loading…</div> : keywords.length === 0 ? <div style={{ fontSize: 12, fontStyle: "italic", color: "var(--ink-3)" }}>No keywords set. Add one above.</div> : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {keywords.map(kw => (
              <span key={kw.id} className="chip" style={{ background: "var(--accent-bg)", color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}>
                {kw.phrase}
                <button onClick={() => removeKeyword(kw.id)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "4px 0 10px" }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Alert log</span>
        <button className="act" onClick={() => { setLoadingAl(true); loadAlerts(); }}>Refresh</button>
      </div>
      <LogStats items={[{ label: "Total alerts", value: alerts.length, color: "var(--rose)" }, { label: "Showing", value: filtered.length }, { label: "Unique keywords", value: new Set(alerts.map(a => a.keyword)).size }]} />
      <LogFilters search={search} setSearch={setSearch} guild={guild} setGuild={setGuild} guilds={guilds} />
      <div className="card"><div style={{ overflowX: "auto" }}>
        {loadingAl ? <div className="empty">Loading…</div> : filtered.length === 0 ? <div className="empty">No alerts triggered yet.</div> : (
          <table className="dtable" style={{ minWidth: 860 }}>
            <thead><tr><th>Keyword</th><th>Type</th><th>Author</th><th>Channel</th><th>Server</th><th>Content</th><th>Time</th></tr></thead>
            <tbody>{filtered.map(a => (
              <tr key={a.id}>
                <td><span className="chip" style={{ background: "var(--rose-bg)", color: "var(--rose)" }}>{a.keyword}</span></td>
                <td style={{ color: "var(--ink-3)", fontSize: 11 }}>{a.event_type}</td>
                <td><UserCell displayName={a.author_name} username={a.author_name} userId={a.author_id} /></td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>#{a.channel_name || a.channel_id}</td>
                <td style={{ color: "var(--ink-2)", whiteSpace: "nowrap" }}>{a.guild_name}</td>
                <td style={{ maxWidth: 340, lineHeight: 1.5, wordBreak: "break-word" }}>{a.content}</td>
                <td style={{ fontFamily: "var(--v2-mono)", fontSize: 10.5, color: "var(--ink-3)", whiteSpace: "nowrap" }}>{fmtTs(a.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div></div>
    </>
  );
}
/* ── Conversations (L3): team activity stats + AI summaries ── */
function Conversations() {
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().substring(0, 10); });
  const [toDate, setToDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [member, setMember] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [stats, setStats] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [channel, setChannel] = useState("");
  const [channels, setChannels] = useState([]);
  useEffect(() => { getAvailableChannels().then(c => setChannels(c || [])); }, []);
  const lbl = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--ink-3)", marginBottom: 4 };
  const run = async () => {
    setLoading(true);
    const s = await getConversationStats(fromDate, toDate, member, channel);
    setStats(s);
    const sum = await generateConversationSummary(fromDate, toDate, member, channel);
    setSummary(sum);
    setLoading(false);
  };
  return (
    <>
      <div className="card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
            <div style={lbl}>Member (optional)</div>
            <input className="filter-inp" style={{ width: "100%" }} value={member} placeholder="Search by member name…" onChange={e => {
              const v = e.target.value; setMember(v);
              clearTimeout(window.__convoSuggT);
              if (v.length >= 1) window.__convoSuggT = setTimeout(async () => setSuggestions(await getMemberSuggestions(v).catch(() => [])), 250);
              else setSuggestions([]);
            }} />
            {suggestions.length > 0 && member && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, borderRadius: 8, maxHeight: 200, overflowY: "auto", zIndex: 50, background: "var(--panel)", border: "1px solid var(--line-2)" }}>
                {suggestions.map(s => (
                  <div key={s.author_id} style={{ padding: "7px 10px", cursor: "pointer", fontSize: 12.5 }} onClick={() => { setMember(s.author_name); setSuggestions([]); }}>
                    {s.author_name} <span style={{ fontSize: 10, color: "var(--ink-3)" }}>{s.c} msgs</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ minWidth: 170 }}>
            <div style={lbl}>Channel</div>
            <select className="filter-inp" style={{ width: "100%" }} value={channel} onChange={e => setChannel(e.target.value)}>
              <option value="">All channels</option>
              {channels.map(ch => <option key={ch.channel_id} value={ch.channel_id}>#{ch.channel_name}</option>)}
            </select>
          </div>
          <div><div style={lbl}>From</div><input type="date" className="filter-inp" value={fromDate} onChange={e => setFromDate(e.target.value)} /></div>
          <div><div style={lbl}>To</div><input type="date" className="filter-inp" value={toDate} onChange={e => setToDate(e.target.value)} /></div>
          <div style={{ display: "flex", gap: 4 }}>
            {[[7, "7d"], [30, "30d"], [90, "90d"]].map(([d, l]) => (
              <button key={l} className="act" onClick={() => { const to = new Date(); const from = new Date(); from.setDate(from.getDate() - d); setFromDate(from.toISOString().substring(0, 10)); setToDate(to.toISOString().substring(0, 10)); }}>{l}</button>
            ))}
          </div>
          <button className="btn" disabled={loading} onClick={run}>{loading ? "Loading…" : "Fetch stats"}</button>
        </div>
      </div>
      {stats && (
        <>
          <div className="card">
            <div className="hd"><div className="t">Results</div><div className="meta">{stats.members.length} member{stats.members.length !== 1 ? "s" : ""} · {stats.channelsScanned} channels scanned · {stats.totalMessages} messages</div></div>
            <div style={{ overflowX: "auto" }}>
              <table className="dtable" style={{ minWidth: 640 }}>
                <thead><tr><th>Member</th><th style={{ textAlign: "right" }}>Messages ▼</th><th style={{ textAlign: "right" }}>Open tasks</th><th style={{ textAlign: "right" }}>Completed</th><th style={{ textAlign: "right" }}>Total activity</th></tr></thead>
                <tbody>
                  {stats.members.map(m => (
                    <tr key={m.author_id}>
                      <td style={{ fontWeight: 700 }}>{m.author_name}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)" }}>{m.message_count}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: m.openTasks > 0 ? "var(--amber)" : "var(--ink-3)" }}>{m.openTasks}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", color: m.completed > 0 ? "var(--good)" : "var(--ink-3)" }}>{m.completed}</td>
                      <td style={{ textAlign: "right", fontFamily: "var(--v2-mono)", fontWeight: 700 }}>{m.totalActivity}</td>
                    </tr>
                  ))}
                  {stats.members.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-3)" }}>No activity in date range.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="hd"><div className="t">Channels</div><div className="meta">{stats.channels.length}</div></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 6, paddingTop: 6 }}>
              {stats.channels.map(ch => (
                <div key={ch.channel_id} style={{ padding: "8px 10px", borderRadius: 8, background: "var(--panel-2)" }}>
                  <div style={{ fontFamily: "var(--v2-mono)", fontSize: 11, color: "var(--accent)" }}>#{ch.channel_name}</div>
                  <div style={{ fontSize: 10, color: "var(--ink-3)" }}>{ch.message_count} msgs · {ch.unique_members} members</div>
                </div>
              ))}
            </div>
          </div>
          {summary && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
              <div className="card" style={{ marginBottom: 0 }}><div className="hd"><div className="t">Team themes</div></div>
                <div className="quill-content" style={{ fontSize: 13, color: "var(--ink-1)" }} dangerouslySetInnerHTML={{ __html: summary.teamThemes }} />
              </div>
              <div className="card" style={{ marginBottom: 0 }}><div className="hd"><div className="t">Summary: {member || "All members"}</div></div>
                {member
                  ? <div className="quill-content" style={{ fontSize: 13, color: "var(--ink-1)" }} dangerouslySetInnerHTML={{ __html: summary.memberSummary || '<em style="color:var(--ink-3)">Select a member to see their individual summary.</em>' }} />
                  : <div style={{ fontSize: 13, color: "var(--ink-3)" }}><em>Select a member above to see their individual activity summary.</em></div>}
              </div>
              <div className="card" style={{ marginBottom: 0 }}><div className="hd"><div className="t">By channel</div></div>
                <div className="quill-content" style={{ fontSize: 13, color: "var(--ink-1)" }} dangerouslySetInnerHTML={{ __html: summary.channelSummaries }} />
              </div>
            </div>
          )}
        </>
      )}
      {!stats && !loading && <div className="empty">Set a date range and click <strong>Fetch stats</strong> to load conversation data and AI summaries.</div>}
    </>
  );
}

export { Audit, Archive, ServerLogs, Conversations };
