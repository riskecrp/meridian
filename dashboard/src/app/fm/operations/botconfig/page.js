"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../../lib/useAuth";
import { useDialog } from "../../../../lib/useDialog";
import { getBotServerConfigs, addBotServerConfig, updateBotServerConfig, deleteBotServerConfig, addBotWatchRole, deleteBotWatchRole } from "../actions";
import { getFactionNames } from "../../factions/actions";
import { st } from "../_shared/styles";
import OperationsShell from "../_shared/Shell";

const FIELD = {
  base: { padding: '5px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-0)',
    color: 'var(--fg-0)', fontSize: 11, width: '100%', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' },
};

function ServerCard({ server, factions, onRefresh, showConfirm, showForm }) {
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing]     = useState(false);
  const [form, setForm]           = useState({});
  const [saving, setSaving]       = useState(false);

  const startEdit = () => {
    setForm({
      guild_name:        server.guild_name        || '',
      access_role_id:    server.access_role_id    || '',
      access_role_name:  server.access_role_name  || '',
      comms_channel_id:  server.comms_channel_id  || '',
      comms_channel_name: server.comms_channel_name || '',
      faction_channel_id:  server.faction_channel_id  || '',
      faction_channel_name: server.faction_channel_name || '',
      faction:           server.faction_name       || '',
    });
    setEditing(true);
    setCollapsed(false);
  };
  const cancelEdit = () => setEditing(false);
  const saveEdit   = async () => {
    setSaving(true);
    await updateBotServerConfig(server.id, form);
    setSaving(false);
    setEditing(false);
    onRefresh();
  };
  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const handleAddWatch = async () => {
    const res = await showForm("Add Monitored Role", [
      { name: 'role_id',   label: 'Role ID',   type: 'text', placeholder: 'Role ID the bot watches for pings' },
      { name: 'role_name', label: 'Role Name', type: 'text', placeholder: 'e.g. @leadership' },
    ]);
    if (!res?.role_id) return;
    await addBotWatchRole({ config_id: server.id, ...res });
    onRefresh();
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}>

      {/* ── Header (always visible, click to collapse) ── */}
      <div
        className="px-5 py-3 flex justify-between items-center"
        style={{ background: 'var(--bg-2)', borderBottom: collapsed ? 'none' : '1px solid var(--border)', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => { if (!editing) setCollapsed(c => !c); }}
      >
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 12, color: 'var(--fg-4)' }}>{collapsed ? '▶' : '▼'}</span>
          <div>
            <div className="font-bold text-sm">{server.guild_name || 'Unnamed Server'}</div>
            <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--fg-4)' }}>{server.guild_id}</div>
          </div>
          {server.faction_name && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 3,
              background: 'rgba(167,139,250,0.12)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }}>
              {server.faction_name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {!editing && (
            <button style={{ fontSize: 11, color: 'var(--accent)', background: 'none', border: '1px solid var(--border)', borderRadius: 5, padding: '3px 10px', cursor: 'pointer' }}
              onClick={startEdit}>Edit</button>
          )}
          <button style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={async () => {
              if (await showConfirm(`Remove ${server.guild_name || server.guild_id} and all its roles?`)) {
                await deleteBotServerConfig(server.id); onRefresh();
              }
            }}>Remove</button>
        </div>
      </div>

      {/* ── Body ── */}
      {!collapsed && (
        editing ? (
          /* ── Edit mode ── */
          <div className="px-5 py-4 space-y-3">
            <div className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--fg-4)', letterSpacing: '0.08em' }}>Editing — {server.guild_id}</div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] mb-1" style={{ color: 'var(--fg-4)' }}>Server Name</div>
                <input style={FIELD.base} value={form.guild_name} onChange={f('guild_name')} placeholder="e.g. Alliance Discord" />
              </div>
              <div>
                <div className="text-[10px] mb-1" style={{ color: 'var(--fg-4)' }}>Linked Faction</div>
                <select style={FIELD.base} value={form.faction} onChange={f('faction')}>
                  <option value=''>— None —</option>
                  {factions.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <div className="text-[10px] mb-1" style={{ color: 'var(--fg-4)' }}>Access Role ID</div>
                <input style={FIELD.base} value={form.access_role_id} onChange={f('access_role_id')} placeholder="Role required to log into DB site" />
              </div>
              <div>
                <div className="text-[10px] mb-1" style={{ color: 'var(--fg-4)' }}>Access Role Name</div>
                <input style={FIELD.base} value={form.access_role_name} onChange={f('access_role_name')} placeholder="e.g. Ally Member" />
              </div>
              <div>
                <div className="text-[10px] mb-1" style={{ color: 'var(--fg-4)' }}>Command Channel ID</div>
                <input style={FIELD.base} value={form.comms_channel_id} onChange={f('comms_channel_id')} placeholder="Right-click channel → Copy ID" />
              </div>
              <div>
                <div className="text-[10px] mb-1" style={{ color: 'var(--fg-4)' }}>Command Channel Name</div>
                <input style={FIELD.base} value={form.comms_channel_name} onChange={f('comms_channel_name')} placeholder="e.g. #command" />
              </div>
              <div>
                <div className="text-[10px] mb-1" style={{ color: 'var(--fg-4)' }}>Faction-Wide Channel ID</div>
                <input style={FIELD.base} value={form.faction_channel_id} onChange={f('faction_channel_id')} placeholder="Right-click channel → Copy ID" />
              </div>
              <div>
                <div className="text-[10px] mb-1" style={{ color: 'var(--fg-4)' }}>Faction-Wide Channel Name</div>
                <input style={FIELD.base} value={form.faction_channel_name} onChange={f('faction_channel_name')} placeholder="e.g. #announcements" />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button style={st.btn} onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</button>
              <button onClick={cancelEdit}
                style={{ fontSize: 11, padding: '5px 12px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--fg-3)', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          /* ── View mode ── */
          <>
            {/* Details grid */}
            <div className="px-5 py-3 grid grid-cols-2 md:grid-cols-4 gap-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <div>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--fg-4)' }}>Access Role</div>
                {server.access_role_id ? (
                  <>
                    <div className="text-sm font-medium">{server.access_role_name || <span style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}>Unnamed</span>}</div>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--fg-4)' }}>{server.access_role_id}</div>
                  </>
                ) : (
                  <div className="text-[11px]" style={{ color: 'var(--red)', fontStyle: 'italic' }}>Not set</div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--fg-4)' }}>Command Channel</div>
                {server.comms_channel_id ? (
                  <>
                    <div className="text-sm font-medium">{server.comms_channel_name || <span style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}>Unnamed</span>}</div>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--fg-4)' }}>{server.comms_channel_id}</div>
                  </>
                ) : (
                  <div className="text-[11px]" style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}>Not set</div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--fg-4)' }}>Faction-Wide Channel</div>
                {server.faction_channel_id ? (
                  <>
                    <div className="text-sm font-medium">{server.faction_channel_name || <span style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}>Unnamed</span>}</div>
                    <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--fg-4)' }}>{server.faction_channel_id}</div>
                  </>
                ) : (
                  <div className="text-[11px]" style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}>Not set</div>
                )}
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase mb-1" style={{ color: 'var(--fg-4)' }}>Linked Faction</div>
                <div className="text-sm" style={{ color: server.faction_name ? 'var(--accent)' : 'var(--fg-4)', fontStyle: server.faction_name ? 'normal' : 'italic' }}>
                  {server.faction_name || 'None'}
                </div>
              </div>
            </div>

            {/* Monitored roles */}
            <div className="px-5 py-3">
              <div className="flex justify-between items-center mb-2">
                <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--fg-4)' }}>
                  Monitored Roles <span style={{ fontWeight: 400 }}>— pings tracked on FM Dashboard</span>
                </div>
                <button style={{ ...st.btn, fontSize: 10, padding: '2px 8px' }} onClick={handleAddWatch}>+ Add Role</button>
              </div>

              {server.watchRoles.length === 0 ? (
                <div className="text-[11px] py-2" style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}>No roles monitored.</div>
              ) : (
                <div className="space-y-1">
                  {server.watchRoles.map(r => (
                    <div key={r.id} className="flex justify-between items-center py-1.5 px-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
                      <div>
                        <span className="text-sm font-medium">{r.role_name || <span style={{ color: 'var(--fg-4)', fontStyle: 'italic' }}>Unnamed</span>}</span>
                        <span className="text-[10px] font-mono ml-3" style={{ color: 'var(--fg-4)' }}>{r.role_id}</span>
                      </div>
                      <button style={{ fontSize: 11, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}
                        onClick={async () => {
                          if (await showConfirm(`Remove monitored role ${r.role_name || r.role_id}?`)) {
                            await deleteBotWatchRole(r.id); onRefresh();
                          }
                        }}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )
      )}
    </div>
  );
}

export default function BotConfigPage() {
  const auth = useAuth();
  const { showConfirm, showForm } = useDialog();
  const [servers, setServers]   = useState([]);
  const [factions, setFactions] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (auth.loading || auth.level < 3) return;
    Promise.all([getBotServerConfigs(), getFactionNames()]).then(([s, f]) => {
      setServers(s || []); setFactions(f || []); setLoading(false);
    });
  }, [auth.loading, auth.level]);

  const refresh = () => getBotServerConfigs().then(setServers);

  if (auth.loading) return <div className="p-10 text-sm animate-pulse" style={{ color: 'var(--accent)' }}>Loading...</div>;
  if (auth.level < 3) return <div className="p-10" style={{ color: 'var(--red)' }}>Access denied.</div>;
  if (loading) return <div className="p-10 text-sm animate-pulse" style={{ color: 'var(--accent)' }}>Loading...</div>;

  const handleAddServer = async () => {
    const res = await showForm("Add Bot Server", [
      { name: 'guild_id',          label: 'Discord Server ID',      type: 'text', placeholder: 'Right-click server → Copy ID' },
      { name: 'guild_name',        label: 'Server Name',            type: 'text', placeholder: 'e.g. Alliance Discord' },
      { name: 'faction',           label: 'Linked Faction',         type: 'select',
        options: [{ label: '— None —', value: '' }, ...factions.map(f => ({ label: f, value: f }))] },
      { name: 'access_role_id',    label: 'Access Role ID',         type: 'text', placeholder: 'Role required to log into DB site' },
      { name: 'access_role_name',  label: 'Access Role Name',       type: 'text', placeholder: 'e.g. Ally Member' },
      { name: 'comms_channel_id',  label: 'Command Channel ID',     type: 'text', placeholder: 'Right-click channel → Copy ID' },
      { name: 'comms_channel_name',label: 'Command Channel Name',   type: 'text', placeholder: 'e.g. #command' },
      { name: 'faction_channel_id',  label: 'Faction-Wide Channel ID',   type: 'text', placeholder: 'Right-click channel → Copy ID' },
      { name: 'faction_channel_name',label: 'Faction-Wide Channel Name', type: 'text', placeholder: 'e.g. #announcements' },
    ]);
    if (!res?.guild_id) return;
    const result = await addBotServerConfig(res);
    if (result?.error) { alert(result.error); return; }
    refresh();
  };

  return (
    <OperationsShell title="Bot Server Config" docs={[{"title": "Faction Administration", "label": "Bot Server Configuration Guide", "minLevel": 3}]} authLevel={auth?.level || 3}>
      <div className="space-y-5">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-sm" style={{ color: 'var(--fg-3)' }}>
              Configure each Discord server the bot is invited to. Click a server header to collapse it.
            </div>
            <div className="text-[10px] mt-1 font-mono" style={{ color: 'var(--fg-4)' }}>
              Access Role — login gate for meridiandatabase.net &nbsp;·&nbsp;
              Command Channel — leadership target for announcements &nbsp;·&nbsp;
              Faction-Wide Channel — whole-faction target &nbsp;·&nbsp;
              Monitored Roles — pings shown on FM Dashboard
            </div>
          </div>
          <button style={st.btn} onClick={handleAddServer}>Add Server +</button>
        </div>

        {servers.length === 0 && (
          <div className="py-10 text-center text-sm" style={{ color: 'var(--fg-4)' }}>No servers configured yet.</div>
        )}

        {servers.map(server => (
          <ServerCard
            key={server.id}
            server={server}
            factions={factions}
            onRefresh={refresh}
            showConfirm={showConfirm}
            showForm={showForm}
          />
        ))}
      </div>
    </OperationsShell>
  );
}
