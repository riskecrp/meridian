"use client";
import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { getFMStaffWithLinks, setCharacterLink, getFMHoursForPeriod, saveFMHours, getFMScenesForPeriod, getFMMeetingsForPeriod, postFMReport } from "./actions";

const RISK_ID = "738214924760907907";

const s = {
  card:    { background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 12 },
  input:   { background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "var(--fg-1)", outline: "none", width: "100%" },
  btn:     { background: "var(--accent)", color: "#fff", border: "none", padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer" },
  ghost:   { background: "transparent", color: "var(--fg-2)", border: "1px solid var(--border)", padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" },
  label:   { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--fg-4)", marginBottom: 6, display: "block" },
  tab:     (a) => ({ padding: "8px 20px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", cursor: "pointer", background: "none", border: "none", borderBottom: a ? "2px solid var(--accent)" : "2px solid transparent", color: a ? "var(--accent)" : "var(--fg-4)" }),
  th:      { padding: "9px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--fg-4)" },
  td:      { padding: "8px 14px", fontSize: 12 },
};

// Same CSV parser logic as LSEMS payroll
function parseCSV(raw) {
  const lines = raw.trim().split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headerIdx = lines.findIndex(l => l.toLowerCase().startsWith("name,"));
  if (headerIdx === -1) return [];
  const headers  = lines[headerIdx].split(",").map(h => h.trim().toLowerCase());
  const nameCol  = headers.indexOf("name");
  const hoursCol = headers.findIndex(h => h.includes("duty hours") || h === "on duty hours");
  if (nameCol === -1 || hoursCol === -1) return [];
  const result = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols     = lines[i].split(",");
    const rawName  = (cols[nameCol] || "").trim().replace(/_/g, " ");
    if (!rawName) continue;
    result.push({ rawName, hours: parseFloat(cols[hoursCol]) || 0 });
  }
  return result;
}

// Default to the previous month — you report on the month that just ended
function defaultPeriod() {
  const d = new Date();
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, "0")}`;
}

// ── Tab: Character Links ───────────────────────────────────────
function CharacterLinks({ staff, onSaved }) {
  const [edits, setEdits]   = useState({});
  const [saving, setSaving] = useState({});

  const get = (discordId, field, fallback) =>
    edits[discordId]?.[field] !== undefined ? edits[discordId][field] : fallback;

  const set = (discordId, field, value) =>
    setEdits(p => ({ ...p, [discordId]: { ...p[discordId], [field]: value } }));

  const isDirty = (m) => {
    const e = edits[m.discord_id];
    if (!e) return false;
    return (e.character_name !== undefined && e.character_name !== m.character_name) ||
           (e.category       !== undefined && e.category       !== m.category);
  };

  const save = async (m) => {
    if (!isDirty(m)) return;
    setSaving(p => ({ ...p, [m.discord_id]: true }));
    const charName = get(m.discord_id, "character_name", m.character_name);
    const category = get(m.discord_id, "category",       m.category);
    await setCharacterLink(m.discord_id, charName, category);
    setSaving(p => ({ ...p, [m.discord_id]: false }));
    onSaved();
  };

  return (
    <div>
      <p style={{ fontSize: 12, color: "var(--fg-4)", marginBottom: 20 }}>
        Link each FM member to their in-game character name and mark whether they are Support or Moderator — this determines which group they appear in on the monthly report.
      </p>
      <div style={s.card}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid var(--border)" }}>
              <th style={s.th}>Display Name</th>
              <th style={s.th}>Team</th>
              <th style={s.th}>Character Name</th>
              <th style={{ ...s.th, width: 140 }}>Group</th>
              <th style={{ ...s.th, width: 70 }}></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((m, i) => {
              const charVal = get(m.discord_id, "character_name", m.character_name);
              const catVal  = get(m.discord_id, "category",       m.category);
              const dirty   = isDirty(m);
              return (
                <tr key={m.discord_id} style={{ borderBottom: "1px solid var(--border)", background: i % 2 ? "rgba(255,255,255,0.012)" : "transparent" }}>
                  <td style={{ ...s.td, color: "var(--fg-0)", fontWeight: 600 }}>{m.display_name}</td>
                  <td style={{ ...s.td, color: "var(--fg-3)" }}>{m.team_name || "Unassigned"}</td>
                  <td style={s.td}>
                    <input
                      style={{ ...s.input, borderColor: dirty ? "var(--accent)" : "var(--border)" }}
                      value={charVal}
                      placeholder="In-game character name…"
                      onChange={e => set(m.discord_id, "character_name", e.target.value)}
                      onKeyDown={e => e.key === "Enter" && save(m)}
                    />
                  </td>
                  <td style={s.td}>
                    <select
                      style={{ ...s.input,
                        borderColor: dirty ? "var(--accent)" : "var(--border)",
                        color: catVal === "moderator" ? "var(--amber)" : catVal === "non-fm" ? "var(--fg-4)" : "var(--blue)",
                        fontWeight: 700,
                      }}
                      value={catVal}
                      onChange={e => set(m.discord_id, "category", e.target.value)}
                    >
                      <option value="support">Support</option>
                      <option value="moderator">Moderator</option>
                      <option value="non-fm">Non-FM (exclude)</option>
                    </select>
                  </td>
                  <td style={s.td}>
                    {dirty && (
                      <button
                        onClick={() => save(m)}
                        disabled={saving[m.discord_id]}
                        style={{ ...s.btn, padding: "5px 12px", fontSize: 11, opacity: saving[m.discord_id] ? 0.5 : 1 }}
                      >Save</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tab: Import Hours ──────────────────────────────────────────
function ImportHours({ staff }) {
  const [csv, setCsv]         = useState("");
  const [parsed, setParsed]   = useState(null);
  const [period, setPeriod]   = useState(defaultPeriod());
  const [error, setError]     = useState("");
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  // Build character name → discord_id map
  const charMap = useMemo(() => {
    const m = {};
    staff.forEach(s => {
      if (s.character_name) m[s.character_name.toLowerCase()] = s;
    });
    return m;
  }, [staff]);

  const handleParse = () => {
    setError(""); setParsed(null); setSaved(false);
    const rows = parseCSV(csv);
    if (!rows.length) { setError("Could not parse — paste the full export including the header row (must start with \"Name,\" and include an \"On Duty Hours\" column)."); return; }
    const matched = rows.map(r => ({
      ...r,
      staff: charMap[r.rawName.toLowerCase()] || null,
    }));
    setParsed(matched);
  };

  const handleSave = async () => {
    if (!parsed) return;
    setSaving(true);
    const entries = parsed.filter(r => r.staff).map(r => ({ discord_id: r.staff.discord_id, hours: r.hours }));
    const res = await saveFMHours(period, entries);
    setSaving(false);
    if (res.ok) setSaved(true);
    else setError(res.error);
  };

  const matched   = parsed?.filter(r => r.staff).length ?? 0;
  const unmatched = parsed?.filter(r => !r.staff).length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "end" }}>
        <div>
          <label style={s.label}>Period</label>
          <input style={{ ...s.input, maxWidth: 160 }} type="month" value={period} onChange={e => setPeriod(e.target.value)} />
        </div>
      </div>

      <div>
        <label style={s.label}>Paste Hours Data (CSV)</label>
        <textarea
          style={{ ...s.input, fontFamily: "var(--font-mono)", fontSize: 11, minHeight: 180, resize: "vertical" }}
          placeholder={"Name,Branch,Group,On Duty Hours,Pay Amount\nJohn Character,Branch,Group,12.50,0\n…"}
          value={csv}
          onChange={e => { setCsv(e.target.value); setParsed(null); setSaved(false); }}
        />
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button style={s.btn} onClick={handleParse} disabled={!csv.trim()}>Parse & Preview</button>
        {parsed && <button style={{ ...s.btn, background: "var(--green)", opacity: saving ? 0.5 : 1 }} onClick={handleSave} disabled={saving || matched === 0}>
          {saving ? "Saving…" : `Save ${matched} matched`}
        </button>}
        {saved && <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>✓ Saved</span>}
      </div>

      {error && <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--red-bg)", border: "1px solid rgba(248,113,113,0.2)", fontSize: 12, color: "var(--red)" }}>{error}</div>}

      {parsed && (
        <div style={s.card}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", gap: 16, fontSize: 11 }}>
            <span style={{ color: "var(--green)", fontWeight: 700 }}>✓ {matched} matched</span>
            {unmatched > 0 && <span style={{ color: "var(--amber)", fontWeight: 700 }}>⚠ {unmatched} unmatched (no character link)</span>}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid var(--border)" }}>
                <th style={s.th}>Character Name (CSV)</th>
                <th style={s.th}>FM Member</th>
                <th style={{ ...s.th, textAlign: "right" }}>Hours</th>
              </tr>
            </thead>
            <tbody>
              {parsed.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--border)", background: i % 2 ? "rgba(255,255,255,0.012)" : "transparent" }}>
                  <td style={{ ...s.td, color: "var(--fg-1)", fontFamily: "var(--font-mono)" }}>{r.rawName}</td>
                  <td style={s.td}>
                    {r.staff
                      ? <span style={{ color: "var(--green)" }}>{r.staff.display_name}</span>
                      : <span style={{ color: "var(--amber)", fontStyle: "italic" }}>No match — set character link</span>}
                  </td>
                  <td style={{ ...s.td, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--fg-0)" }}>{r.hours.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab: Post Report ───────────────────────────────────────────
function PostReport({ staff }) {
  const [period, setPeriod]     = useState(defaultPeriod());
  const [testMode, setTest]     = useState(true);
  const [hours, setHours]       = useState({});
  const [scenes, setScenes]     = useState({});
  const [meetings, setMeetings] = useState({});
  const [loading, setLoading]   = useState(false);
  const [posting, setPosting]   = useState(false);
  const [result, setResult]     = useState(null);

  const loadData = async () => {
    if (!period) return;
    setLoading(true); setResult(null);
    const [y, m] = period.split("-").map(Number);
    const [h, sc, mt] = await Promise.all([
      getFMHoursForPeriod(period),
      getFMScenesForPeriod(y, m),
      getFMMeetingsForPeriod(y, m),
    ]);
    const hm = {};
    h.forEach(r => { hm[r.discord_id] = r.hours; });
    setHours(hm); setScenes(sc); setMeetings(mt);
    setLoading(false);
  };

  const handlePost = async () => {
    setPosting(true); setResult(null);
    const res = await postFMReport({ period, testMode });
    setPosting(false); setResult(res);
  };

  const monthName = period
    ? new Date(+period.split("-")[0], +period.split("-")[1] - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" })
    : "";

  const support = staff.filter(s => s.category === "support");
  const modPlus = staff.filter(s => s.category === "moderator");
  // Non-FM members are excluded from both sections

  const MemberRow = ({ m }) => (
    <tr style={{ borderBottom: "1px solid var(--border)" }}>
      <td style={{ ...s.td, color: "var(--fg-0)", fontWeight: 600 }}>{m.display_name}</td>
      <td style={{ ...s.td, textAlign: "right", fontFamily: "var(--font-mono)", fontWeight: 600, color: hours[m.discord_id] ? "var(--fg-0)" : "var(--fg-4)" }}>
        {(hours[m.discord_id] || 0).toFixed(1)}h
      </td>
      <td style={{ ...s.td, textAlign: "right", fontFamily: "var(--font-mono)", color: scenes[m.discord_id] ? "var(--accent)" : "var(--fg-4)" }}>
        {scenes[m.discord_id] || 0}
      </td>
      <td style={{ ...s.td, textAlign: "right", fontFamily: "var(--font-mono)", color: meetings[m.discord_id] ? "var(--green)" : "var(--fg-4)" }}>
        {meetings[m.discord_id] || "—"}
      </td>
    </tr>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Legend */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {[
          { label: "Clocked On Hours", desc: "Meridian RP"            },
          { label: "Avg Scene",        desc: "≈ 2 hours"              },
          { label: "Avg Meeting",      desc: "≈ 1 hour"    },
        ].map(({ label, desc }) => (
          <div key={label} style={{ padding: "8px 14px", borderRadius: 8, background: "var(--bg-2)", border: "1px solid var(--border)", fontSize: 12 }}>
            <span style={{ color: "var(--fg-4)", fontWeight: 600 }}>{label}: </span>
            <span style={{ color: "var(--fg-1)" }}>{desc}</span>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <label style={s.label}>Period</label>
          <input style={{ ...s.input, maxWidth: 160 }} type="month" value={period} onChange={e => setPeriod(e.target.value)} />
        </div>
        <button style={s.ghost} onClick={loadData} disabled={loading}>{loading ? "Loading…" : "Load Data"}</button>
      </div>

      {/* Preview table */}
      {(Object.keys(hours).length > 0 || Object.keys(scenes).length > 0) && (
        <>
          <div style={s.card}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700, color: "var(--blue)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Support Staff — {monthName}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid var(--border)" }}>
                <th style={s.th}>Name</th>
                <th style={{ ...s.th, textAlign: "right" }}>Hours</th>
                <th style={{ ...s.th, textAlign: "right" }}>Scenes</th>
                <th style={{ ...s.th, textAlign: "right" }}>Meetings</th>
              </tr></thead>
              <tbody>{support.map(m => <MemberRow key={m.discord_id} m={m} />)}</tbody>
            </table>
          </div>

          <div style={s.card}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700, color: "var(--amber)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Moderator+ — {monthName}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "rgba(255,255,255,0.025)", borderBottom: "1px solid var(--border)" }}>
                <th style={s.th}>Name</th>
                <th style={{ ...s.th, textAlign: "right" }}>Hours</th>
                <th style={{ ...s.th, textAlign: "right" }}>Scenes</th>
                <th style={{ ...s.th, textAlign: "right" }}>Meetings</th>
              </tr></thead>
              <tbody>{modPlus.map(m => <MemberRow key={m.discord_id} m={m} />)}</tbody>
            </table>
          </div>

          {/* Post controls */}
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "16px 20px", borderRadius: 12, background: testMode ? "rgba(251,191,36,0.06)" : "rgba(248,113,113,0.05)", border: `1px solid ${testMode ? "rgba(251,191,36,0.2)" : "rgba(248,113,113,0.2)"}` }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, color: testMode ? "var(--amber)" : "var(--red)" }}>
              <input type="checkbox" checked={testMode} onChange={e => setTest(e.target.checked)} />
              {testMode ? "Test mode (posts to test server)" : "LIVE mode (posts to production)"}
            </label>
            <button
              style={{ ...s.btn, background: testMode ? "var(--amber)" : "var(--red)", color: testMode ? "#000" : "#fff", opacity: posting ? 0.5 : 1 }}
              onClick={handlePost}
              disabled={posting}
            >
              {posting ? "Posting…" : testMode ? "Post to Test Server" : "Post Live Report"}
            </button>
            {result && (
              <span style={{ fontSize: 12, fontWeight: 600, color: result.ok ? "var(--green)" : "var(--red)" }}>
                {result.ok ? `✓ Posted${result.testMode ? " to test server" : " live"}` : `✗ ${result.error}`}
              </span>
            )}
          </div>
        </>
      )}

      {Object.keys(hours).length === 0 && Object.keys(scenes).length === 0 && (
        <div style={{ padding: 32, textAlign: "center", color: "var(--fg-4)", fontSize: 13, fontStyle: "italic" }}>
          Select a period and click Load Data to preview the report.
        </div>
      )}
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────
export default function FMHoursPage() {
  const auth = useAuth();
  const [tab, setTab]     = useState("links");
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadStaff = async () => {
    const data = await getFMStaffWithLinks();
    setStaff(data); setLoading(false);
  };

  useEffect(() => {
    if (!auth.loading && auth.id === RISK_ID) loadStaff();
    else if (!auth.loading) setLoading(false);
  }, [auth.loading, auth.id]);

  if (auth.loading || loading) return null;
  if (auth.id !== RISK_ID) return <div style={{ padding: 48, textAlign: "center", color: "var(--fg-4)", fontStyle: "italic" }}>Access denied.</div>;

  const tabs = [
    { id: "links",  label: "Character Links" },
    { id: "hours",  label: "Import Hours" },
    { id: "report", label: "Post Report" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--fg-0)", letterSpacing: "-0.02em", marginBottom: 4 }}>FM Hours & Activity</h1>
        <p style={{ fontSize: 12, color: "var(--fg-4)" }}>Monthly activity tracking for Faction Management — visible only to you</p>
      </div>
      {/* Two ends of one job: the report is built here, and this opens the
          read-only view that gets sent out. It used to be a separate sidebar
          entry, which made them look like unrelated pages. The route re-checks
          the session itself, so this only ever works for the owner. */}
      {auth?.id === RISK_ID && (
        <a href="/api/auth/verify-impersonate" target="_blank" rel="noopener noreferrer"
          style={{ ...s.ghost, alignSelf: "flex-start", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
          Open the view that gets sent out ↗
        </a>
      )}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        {tabs.map(t => <button key={t.id} style={s.tab(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      {tab === "links"  && <CharacterLinks staff={staff} onSaved={loadStaff} />}
      {tab === "hours"  && <ImportHours staff={staff} />}
      {tab === "report" && <PostReport staff={staff} />}
    </div>
  );
}
