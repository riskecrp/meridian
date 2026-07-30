"use client";
import { useEffect, useState } from "react";
import { useAuth } from "../../../lib/useAuth";
import { listTables, getTableExport, getFullDump } from "./actions";

/*
 * Server Handover / Migration Runbook.
 * L3-only (FM Leadership + Game Affairs Management, per callback/discord role map).
 * Static content — no secrets are rendered here; the .env is referenced by name only.
 * Content is data-driven (RUNBOOK below) so it stays easy to edit.
 */

// ── inline markdown: **bold** and `code` ──
function md(text) {
  const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} style={{ color: "#f1f5f9", fontWeight: 700 }}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={i} style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "0.88em", background: "rgba(129,140,248,0.12)", color: "#c7d2fe", padding: "1px 5px", borderRadius: 4 }}>{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch {}
  };
  return (
    <div style={{ position: "relative", margin: "12px 0" }}>
      <button onClick={copy} style={{
        position: "absolute", top: 8, right: 8, fontSize: 10, fontWeight: 700, padding: "3px 9px", borderRadius: 5, cursor: "pointer",
        fontFamily: "JetBrains Mono, monospace", border: "1px solid rgba(255,255,255,0.12)",
        background: copied ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.05)", color: copied ? "#34d399" : "rgba(255,255,255,0.5)",
      }}>{copied ? "COPIED" : "COPY"}</button>
      <pre style={{
        margin: 0, padding: "14px 16px", paddingRight: 64, borderRadius: 10, overflowX: "auto",
        background: "#0c0c12", border: "1px solid rgba(255,255,255,0.08)",
        fontFamily: "JetBrains Mono, monospace", fontSize: 12.5, lineHeight: 1.6, color: "#d4d4e0",
      }}><code>{code}</code></pre>
    </div>
  );
}

function Note({ tone = "info", children }) {
  const c = tone === "warn"
    ? { bg: "rgba(245,158,11,0.08)", bd: "rgba(245,158,11,0.35)", fg: "#fbbf24", icon: "⚠" }
    : tone === "danger"
    ? { bg: "rgba(248,113,113,0.08)", bd: "rgba(248,113,113,0.35)", fg: "#f87171", icon: "⛔" }
    : { bg: "rgba(99,102,241,0.08)", bd: "rgba(99,102,241,0.3)", fg: "#a5b4fc", icon: "ℹ" };
  return (
    <div style={{ display: "flex", gap: 10, padding: "11px 14px", margin: "12px 0", borderRadius: 10, background: c.bg, border: `1px solid ${c.bd}` }}>
      <span style={{ color: c.fg, fontSize: 14, lineHeight: 1.5, flexShrink: 0 }}>{c.icon}</span>
      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function Table({ head, rows }) {
  return (
    <div style={{ overflowX: "auto", margin: "12px 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
        <thead>
          <tr>{head.map((h, i) => (
            <th key={i} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.45)", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>{r.map((cell, ci) => (
              <td key={ci} style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.72)", verticalAlign: "top", lineHeight: 1.5 }}>{md(cell)}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Plain-English explanation of what each table holds, for a non-technical reader.
const TABLE_DOCS = {
  // ── core / transition data ──
  factions: "The master list of every faction: name, tier, leader, links, and whether it has been archived. The single most important table.",
  faction_history: "A dated timeline of everything that happened to each faction — promotions, edits, and staff notes.",
  faction_members: "The member roster for each faction.",
  faction_reviews: "Monthly leadership reviews and recommendations for each faction.",
  faction_public_messages: "Public notices and announcements shown on each faction's page.",
  faction_ic_contacts: "In-character contact requests sent to factions (story requests).",
  faction_ic_messages: "The back-and-forth messages on those in-character contacts.",
  faction_imports: "Which import items each faction has been permitted to have.",
  faction_fleet_config: "Settings for the faction vehicle (fleet) feature.",
  faction_fleet_garages: "Each faction's garages, where their vehicles are kept.",
  faction_fleet_vehicles: "The actual vehicles owned by each faction.",
  properties: "Every property and location tied to factions — HQs, safehouses, and so on.",
  npcs: "Every non-player character in the world, with their area (turf) and type.",
  spawn_items: "The catalog of in-game items (weapons, etc.) that can be spawned for scenes and NPCs.",
  import_items: "The master catalog of items factions can import, with tier and price.",
  inventory_stock: "The list of items that can be given out in a scene. The stock-count columns are historic and no longer maintained.",
  inventory_logs: "Every item handed out in a scene — what, how many, by whom.",
  fleet_vehicle_catalog: "The reference list of all vehicle types in the game.",
  weapon_ammo: "Reference list of ammunition types.",
  weapon_ammo_compat: "Which ammunition works with which weapons.",
  weapon_attachments: "Reference list of weapon attachments.",
  treasury_logs: "Money going in and out of faction treasuries.",
  pipedown_items: "The menu of items for the in-character shop (“Pipe Down”).",
  pipedown_orders: "Customer orders placed through the Pipe Down shop.",
  pipedown_order_items: "The individual items within each Pipe Down order.",
  scene_logs: "A record of every roleplay scene that was run, with its date and faction.",
  scene_assistants: "Which staff members assisted on each scene.",
  scene_library: "Saved, reusable scene ideas and templates.",
  scene_library_feedback: "Feedback left on scene-library entries.",
  ooc_notes: "Out-of-character notes attached to scenes.",
  change_log: "A log of world and story changes — drop locations, turf edits, and similar.",
  promotion_polls: "Polls used when deciding faction promotions.",
  knowledge_base: "The team's how-to articles and reference information.",
  intel_notes: "Intelligence notes staff recorded about factions and players.",
  documents: "Uploaded documents and guides stored for the team.",
  staff: "The FM staff roster — names, ranks, teams, and access level.",
  staff_coi: "Staff conflicts of interest — factions a staffer is not allowed to oversee.",
  teams: "The FM teams and the Discord channel each one uses.",
  fm_character_links: "Links between staff members and their in-game characters.",
  fm_hours_log: "A log of staff activity hours.",
  leadership_meeting_notes: "Notes from leadership meetings.",
  leadership_personal_notes: "Private notes kept by individual leaders.",
  discord_config: "Which Discord channels the bot posts to (announcements, pings, etc.).",
  discord_roles: "The Discord roles the system recognizes (leadership, guides, etc.).",
  bot_server_configs: "Per-Discord-server settings for the bot.",
  dashboard_access: "People granted special access to this website.",
  mdb_access_roles: "Which Discord roles may enter the member-facing database site.",
  // ── transient / logs (excluded from the bundle) ──
  discord_messages: "A raw archive of Discord messages the bot logged. Very large, and not needed to run FM.",
  edited_message_logs: "A record of edited Discord messages (moderation history).",
  deleted_message_logs: "A record of deleted Discord messages (moderation history).",
  mentions: "A log of pings the bot noticed.",
  role_mentions: "A log of role pings.",
  watch_role_mentions: "A log of pings for specially-watched roles.",
  member_join_leave_logs: "A log of people joining and leaving the Discord server.",
  site_audit_log: "A record of actions taken on this website.",
  tasks: "To-do tasks that are currently open (temporary).",
  task_log: "History of completed and edited tasks.",
  task_questions: "Questions people asked about tasks.",
  reminders: "One-off scheduled reminders.",
  recurring_reminders: "Repeating reminder setups.",
  recurring_reminder_instances: "Each scheduled firing of a repeating reminder.",
  sent_recurring_reminders: "A record of repeating reminders already sent.",
  reminder_purge_channels: "Channels where reminders get automatically cleared.",
  channel_sync_state: "Internal bookkeeping for the bot's channel syncing.",
  channel_purge_schedules: "Schedules for automatically clearing channels.",
  auto_delete_channels: "Channels set to auto-delete their messages.",
  conversation_summaries: "AI-generated summaries of conversations.",
  forwarded_dms: "Direct messages forwarded to staff.",
  keyword_alerts: "Records of watched keywords being triggered.",
  server_log_keywords: "The keywords the bot watches for.",
  bot_watch_roles: "Roles the bot keeps an eye on.",
  sessions: "Active website logins (temporary; the secret token is hidden).",
  mdb_sessions: "Active member-site logins (temporary; the secret token is hidden).",
  pending_executions: "Background jobs waiting to run.",
  deletion_requests: "Requests to delete something, awaiting action.",
  managed_forum_posts: "Forum posts the bot keeps updated.",
};

// ── the runbook content ──────────────────────────────────────────────────────
const RUNBOOK = [
  {
    id: "start-here",
    title: "Start here",
    blocks: [
      { p: "**You do not need to be technical to use this page.** It has two jobs: keep every bit of the faction data safe forever, and give a tech-savvy helper the exact steps to put the system back online if you want to keep it running." },
      { note: { tone: "info", text: "**What Meridian is, in plain words:** three pieces working together — a **Discord bot** (the helper that lives in your Discord server), a **website** (the dashboard staff log into), and a **database** (one single file that holds *all* the data: factions, properties, NPCs, everything). The bot and the website are just windows into that one file." } },
      { p: "**Pick your path:**" },
      { ul: [
        "**Just want to keep the records safe?** Go to section **12 · Database export**, click the two “Handover data” buttons, and save the downloaded files somewhere safe (Google Drive, a hard drive). That preserves everything — no server or website needed. You're done.",
        "**Want the website and bot to keep running?** Sections 1–11 are the setup steps. You are **not** expected to do these yourself — hand this page (or a printout) to a developer or a tech-savvy helper. Every step is written so a technical person can follow it exactly.",
      ] },
      { p: "**The four things you must protect — these are the keys to everything.** Make sure whoever takes over is given access to all four:" },
      { ul: [
        "**The secret settings file** (`.env`) — the system's passwords and keys.",
        "**The database file** (`meridian.db`) — every record. Keep backups of it.",
        "**The Cloudflare account** — controls the web address (ecrpfm.com).",
        "**The Discord developer account** — controls the bot itself.",
      ] },
      { note: { tone: "warn", text: "Losing any of those four is the only truly hard-to-undo part of a handover — transfer them deliberately, in writing." } },
      { note: { tone: "info", text: "**A few words you'll see, in plain English:** a **server** is a computer that runs 24/7 in the cloud · a **database** / **SQLite** is the single file holding the data · a **service** keeps a program running automatically · to **build** is to package the website so it can run · a **tunnel** connects the web address to the software · the **terminal** is the text window where a technical person types the commands shown in the grey boxes." } },
    ],
  },
  {
    id: "overview",
    title: "0 · What this stack is",
    blocks: [
      { p: "Meridian is two Node apps plus a shared SQLite database, all living under **`/opt/meridian`** on a single Linux (Debian/Ubuntu, systemd) host. The public site is fronted by a **Cloudflare Tunnel** — there is no local TLS/nginx for it." },
      { table: { head: ["Component", "Path", "How it runs"], rows: [
        ["Discord bot", "`/opt/meridian/bot` (discord.js 14, ESM)", "systemd `meridian-bot.service` → `node index.js`"],
        ["Dashboard", "`/opt/meridian/dashboard` (Next.js 15, app router)", "systemd `meridian-dashboard.service` → `start.sh` → `next start -p 3000`"],
        ["Shared DB layer", "`/opt/meridian/shared/db.js` (better-sqlite3, WAL)", "imported by both apps"],
        ["Database", "`/opt/meridian/data/meridian.db`", "SQLite WAL; path set by `DATABASE_PATH`"],
        ["Public proxy", "`cloudflared` tunnel", "`ecrpfm.com` → `localhost:3000` (supervised by PM2)"],
      ] } },
      { note: { tone: "info", text: "Both services read env from **`/opt/meridian/.env`** (`EnvironmentFile=` in each unit). The bot and dashboard share one DB file, so they must always point at the same `DATABASE_PATH`." } },
    ],
  },
  {
    id: "prereqs",
    title: "1 · Prepare the new server",
    blocks: [
      { note: { tone: "info", text: "**In plain terms:** this sets up a blank cloud computer with the basic tools the software needs. A technical helper does this once, near the start." } },
      { p: "Provision a Linux VM (Debian 12 / Ubuntu 22.04+ recommended). The current box runs on **~2 GB RAM** — that's the practical floor (Next builds are memory-hungry; see the build note in step 5)." },
      { p: "Install **Node 22.x** (current prod is `v22.22.2`), plus the build toolchain `better-sqlite3` needs to compile its native binding:" },
      { code: "# Node 22 (NodeSource)\ncurl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\nsudo apt-get install -y nodejs\n\n# Build tools for better-sqlite3 native module + sqlite3 CLI + git\nsudo apt-get install -y build-essential python3 sqlite3 git rsync\n\nnode -v   # expect v22.x\nnpm -v    # expect 10.x" },
      { note: { tone: "warn", text: "Do **not** copy `node_modules/` from the old server. `better-sqlite3` is a compiled native module tied to the host's Node/ABI — reinstall it on the new box (step 4)." } },
    ],
  },
  {
    id: "backup",
    title: "2 · Snapshot the database (on the OLD server)",
    blocks: [
      { note: { tone: "info", text: "**In plain terms:** this makes one clean, complete copy of the single file that holds *all* the data. That copy is the most precious thing in this whole process — keep it safe." } },
      { p: "SQLite runs in **WAL mode**, so there are live `meridian.db-wal` / `-shm` sidecar files. Never copy the bare `.db` while the services are writing — use the `.backup` command, which produces a single consistent file with the WAL already folded in:" },
      { code: "cd /opt/meridian/data\nsqlite3 meridian.db \".backup '/tmp/meridian-migrate.db'\"\n\n# sanity check the snapshot\nsqlite3 /tmp/meridian-migrate.db \"PRAGMA integrity_check; SELECT COUNT(*) FROM staff; SELECT COUNT(*) FROM factions;\"" },
      { p: "`integrity_check` must print `ok`. This snapshot is your source of truth for the data — keep a copy somewhere safe before you touch anything else." },
      { note: { tone: "info", text: "The dashboard's **DB Site Access** and **Staff** pages, all faction/scene data, tasks, reminders, sessions, and audit logs all live in this one file. There is no external datastore to migrate." } },
    ],
  },
  {
    id: "code",
    title: "3 · Copy the code (on the OLD server)",
    blocks: [
      { p: "Bundle the application code and config, **excluding** regenerable/host-specific dirs (`node_modules`, `.next` build output, the live data dir, and local backups):" },
      { code: "cd /opt\ntar czf /tmp/meridian-code.tar.gz \\\n  --exclude='meridian/**/node_modules' \\\n  --exclude='meridian/dashboard/.next' \\\n  --exclude='meridian/data/*.db*' \\\n  --exclude='meridian/data/*.bak-*' \\\n  meridian" },
      { p: "Transfer both artifacts to the new server (adjust host/user), then unpack into `/opt`:" },
      { code: "# from the old server\nrsync -avz /tmp/meridian-code.tar.gz /tmp/meridian-migrate.db  NEWUSER@NEWHOST:/tmp/\n\n# on the NEW server\nsudo mkdir -p /opt\nsudo tar xzf /tmp/meridian-code.tar.gz -C /opt\nsudo mkdir -p /opt/meridian/data\nsudo cp /tmp/meridian-migrate.db /opt/meridian/data/meridian.db" },
      { note: { tone: "info", text: "The `.env` is intentionally left out of the code tarball (secrets). It's handled separately in step 4 — either copy it over a secure channel or rebuild it from the variable list." } },
    ],
  },
  {
    id: "env",
    title: "4 · Recreate the environment file & install deps",
    blocks: [
      { note: { tone: "info", text: "**In plain terms:** the `.env` file is the system's private passwords — never post it anywhere public. “Installing dependencies” just downloads the building blocks the code needs in order to run." } },
      { p: "Create **`/opt/meridian/.env`**. The fastest path is to `scp` the existing file from the old server (it contains the live secret values). If you'd rather rotate everything, rebuild it from this table — every variable both apps read:" },
      { table: { head: ["Variable", "Purpose / where to get it"], rows: [
        ["`DISCORD_CLIENT_ID`", "Discord app → General Information → Application ID"],
        ["`DISCORD_CLIENT_SECRET`", "Discord app → OAuth2 → Client Secret (can be reset)"],
        ["`DISCORD_BOT_TOKEN`", "Discord app → Bot → Token (Reset Token issues a new one)"],
        ["`GUILD_ID`", "The management Discord server ID (default `1457188814916423855`)"],
        ["`DATABASE_PATH`", "`/opt/meridian/data/meridian.db` — keep as-is"],
        ["`BASE_URL`", "`https://ecrpfm.com` — the public origin used to build OAuth redirects"],
        ["`NODE_ENV`", "`production`"],
        ["`SESSION_SECRET`", "Signs dashboard sessions. **Regenerate** with `openssl rand -hex 32` (logs everyone out — fine)"],
        ["`OPENAI_API_KEY`", "AI faction summaries (`/summarize`, summaries). Optional; features degrade without it"],
        ["`IMGBB_API_KEY`", "Image uploads (imgbb). Optional"],
        ["`NOTIFY_SECRET`", "Shared secret for the form-submission notify endpoint"],
        ["`AGENDA_SECRET`", "Shared secret for the read-only my-agenda endpoint"],
      ] } },
      { note: { tone: "danger", text: "Never commit `.env` or paste its **values** anywhere shared (including this page — that's why only names are listed). Lock it down: `chmod 600 /opt/meridian/.env`." } },
      { p: "Install dependencies for both apps (this compiles `better-sqlite3` for the new host):" },
      { code: "cd /opt/meridian/bot && npm ci\ncd /opt/meridian/dashboard && npm ci" },
      { note: { tone: "info", text: "If `npm ci` fails on the native build, confirm `build-essential` + `python3` are installed (step 1), then retry." } },
    ],
  },
  {
    id: "build",
    title: "5 · Build the dashboard",
    blocks: [
      { p: "The dashboard serves a **prebuilt** `.next`. `start.sh` deliberately refuses to build on boot (parallel builds OOM a small VM), so you must build once by hand before starting:" },
      { code: "cd /opt/meridian/dashboard\nnpm run build   # produces .next/BUILD_ID" },
      { note: { tone: "warn", text: "On a ~2 GB VM the build can be tight. If it gets OOM-killed, give Node more headroom: `NODE_OPTIONS=--max-old-space-size=1536 npm run build`, or add swap. The bot needs no build step." } },
    ],
  },
  {
    id: "services",
    title: "6 · Install the systemd services",
    blocks: [
      { note: { tone: "info", text: "**In plain terms:** this tells the computer to keep the bot and the website running on their own — and to restart them automatically after any reboot or crash." } },
      { p: "Recreate the two unit files exactly as they are in prod." },
      { p: "**`/etc/systemd/system/meridian-bot.service`**" },
      { code: "[Unit]\nDescription=Meridian Discord Bot\nAfter=network.target\nStartLimitIntervalSec=300\nStartLimitBurst=10\n\n[Service]\nEnvironmentFile=/opt/meridian/.env\nType=simple\nWorkingDirectory=/opt/meridian/bot\nExecStart=/usr/bin/node index.js\nRestart=always\nRestartSec=5\nEnvironment=NODE_ENV=production\n\n[Install]\nWantedBy=multi-user.target" },
      { p: "**`/etc/systemd/system/meridian-dashboard.service`**" },
      { code: "[Unit]\nDescription=Meridian Dashboard\nAfter=network.target\nStartLimitIntervalSec=0\n\n[Service]\nEnvironmentFile=/opt/meridian/.env\nType=simple\nWorkingDirectory=/opt/meridian/dashboard\nExecStart=/bin/bash /opt/meridian/dashboard/start.sh\nRestart=always\nRestartSec=10\nEnvironment=NODE_ENV=production\nEnvironment=NEXT_TELEMETRY_DISABLED=1\n\n[Install]\nWantedBy=multi-user.target" },
      { code: "sudo systemctl daemon-reload\nsudo systemctl enable --now meridian-bot meridian-dashboard\nsudo systemctl status meridian-bot meridian-dashboard --no-pager" },
      { note: { tone: "info", text: "`ExecStart` for the bot is `/usr/bin/node` — confirm `which node` matches, or adjust the path. If you run the services as a non-root user, make sure that user owns `/opt/meridian` and can write `data/`." } },
    ],
  },
  {
    id: "tunnel",
    title: "7 · Domain & TLS — Cloudflare Tunnel",
    blocks: [
      { note: { tone: "info", text: "**In plain terms:** this connects your public web address to the software, and Cloudflare provides the secure padlock (HTTPS) automatically — there are no certificates to buy or renew." } },
      { p: "`ecrpfm.com` is not served by nginx/Caddy — a **Cloudflare Tunnel** (`cloudflared`) forwards it to `localhost:3000`. TLS is terminated at Cloudflare's edge, so the new server needs no certificates. You can either move the existing tunnel or create a fresh one." },
      { p: "**Option A — reuse the existing tunnel** (least DNS churn): copy the tunnel credentials + config from the old box:" },
      { code: "# these came from the old server's /root/.cloudflared\n#   config.yml, cert.pem, <tunnel-id>.json\nsudo apt-get install -y cloudflared    # or per Cloudflare's install docs\nsudo mkdir -p /root/.cloudflared\nsudo cp config.yml cert.pem <tunnel-id>.json /root/.cloudflared/" },
      { p: "The ingress in **`/root/.cloudflared/config.yml`** must map the hostname to the dashboard port:" },
      { code: "tunnel: <tunnel-id>\ncredentials-file: /root/.cloudflared/<tunnel-id>.json\n\ningress:\n  - hostname: ecrpfm.com\n    service: http://localhost:3000\n  - hostname: www.ecrpfm.com\n    service: http://localhost:3000\n  - service: http_status:404" },
      { p: "Run it (prod supervises `cloudflared` with **PM2**; systemd works just as well):" },
      { code: "# PM2 (matches current prod)\npm2 start \"cloudflared tunnel run <tunnel-id>\" --name cloudflared\npm2 save\n\n# — or — install it as a systemd service instead\nsudo cloudflared service install\nsudo systemctl enable --now cloudflared" },
      { note: { tone: "warn", text: "**Option B — new tunnel:** run `cloudflared tunnel login`, `cloudflared tunnel create meridian`, then `cloudflared tunnel route dns meridian ecrpfm.com` (and `www`). In the Cloudflare DNS panel the record becomes a CNAME to `<tunnel-id>.cfargotunnel.com`. Only one tunnel should own the hostname at a time — stop the old one before cutting over to avoid split routing." } },
    ],
  },
  {
    id: "discord",
    title: "8 · Discord app settings that must match",
    blocks: [
      { note: { tone: "info", text: "**In plain terms:** the bot and the staff login are both run by one Discord “application.” As long as you keep control of that Discord developer account, you keep the bot." } },
      { p: "The bot and dashboard log in through one Discord application. If you keep the same app + token, no Discord changes are needed beyond confirming these. If you rotate the token/secret, update `.env` accordingly." },
      { p: "**OAuth2 → Redirects** must contain both callback URLs (built from `BASE_URL`):" },
      { code: "https://ecrpfm.com/api/auth/callback/discord\nhttps://ecrpfm.com/api/auth/verify/callback" },
      { table: { head: ["Setting", "Value"], rows: [
        ["Bot intents", "Server Members + Message Content (Bot tab → Privileged Gateway Intents)"],
        ["Login scopes", "`identify` (main) and `identify guilds` (verify flow) — set in code, no action needed"],
        ["Slash commands", "Registered **per-guild** to `GUILD_ID` on every bot boot — they appear instantly, no global wait"],
        ["Bot in server", "The bot user must still be a member of the `GUILD_ID` server with its roles"],
      ] } },
      { note: { tone: "info", text: "Dashboard access is role-derived at login: the L3 roles `fm_leadership`, `game_affairs`, `founder`, `executive_admin` map to clearance 3; L2/L1 come from the configured team-lead/guide roles. Individual overrides live in the `dashboard_access` table (managed from **Operations → DB Site Access**)." } },
    ],
  },
  {
    id: "verify",
    title: "9 · Start & verify the cutover",
    blocks: [
      { p: "With services up and the tunnel pointed at the new box:" },
      { code: "# dashboard responds locally (307 = normal auth redirect, NOT an error)\ncurl -s -o /dev/null -w '%{http_code}\\n' http://localhost:3000/fm/dashboard\n\n# service health + recent logs\nsystemctl is-active meridian-bot meridian-dashboard\njournalctl -u meridian-bot -n 30 --no-pager      # look for \"Ready as ...\" + \"Commands registered\"\njournalctl -u meridian-dashboard -n 30 --no-pager" },
      { ul: [
        "Bot log shows `Ready as Meridian Database#…` and `Commands registered`.",
        "Visit `https://ecrpfm.com` through the tunnel and complete a Discord login end-to-end.",
        "Run `/matrix teams` in Discord and open a couple of dashboard tabs to confirm live DB reads.",
        "Confirm the bot is online in the server member list.",
      ] },
      { note: { tone: "warn", text: "Cut over during a quiet window. Because both old and new boxes point at their own copy of the DB, any writes on the old server after you took the snapshot are lost — stop the old services (`systemctl stop meridian-bot meridian-dashboard`) before flipping the tunnel so nothing is written to the stale copy." } },
    ],
  },
  {
    id: "ops",
    title: "10 · Day-to-day: how to deploy changes",
    blocks: [
      { p: "Keep this handy — the two apps deploy differently:" },
      { table: { head: ["Change to…", "Command"], rows: [
        ["**Bot** (`bot/`)", "`sudo systemctl restart meridian-bot` — re-registers slash commands on boot"],
        ["**Dashboard** (`dashboard/`)", "`cd /opt/meridian/dashboard && npm run build && sudo systemctl restart meridian-dashboard`"],
        ["**Data only** (SQLite rows)", "No restart — both live services see committed writes immediately"],
      ] } },
      { note: { tone: "warn", text: "`start.sh` will **not** build for you — editing dashboard source without `npm run build` serves the OLD `.next`. Always build before restarting the dashboard." } },
      { p: "**Before any data edit**, back up first:" },
      { code: "cd /opt/meridian/data\nsqlite3 meridian.db \".backup 'meridian.db.bak-<desc>-$(date +%F)'\"" },
      { note: { tone: "info", text: "SQLite dates are inconsistent across tables (`scene_logs.date` is `DD/MON/YYYY`, `tasks.created_at` is ISO 8601). When inserting rows, match the column's existing format or you'll break `ORDER BY` string sorts. Set up an offsite copy of `meridian.db` on a schedule — it's the only stateful thing here." } },
    ],
  },
  {
    id: "reference",
    title: "11 · Quick reference",
    blocks: [
      { table: { head: ["Thing", "Value"], rows: [
        ["Repo root", "`/opt/meridian`"],
        ["Database", "`/opt/meridian/data/meridian.db` (WAL)"],
        ["Env file", "`/opt/meridian/.env` (chmod 600)"],
        ["Dashboard port", "`3000` (internal; public via tunnel)"],
        ["Node version", "`v22.x`"],
        ["Services", "`meridian-bot.service`, `meridian-dashboard.service`"],
        ["Public URL", "`https://ecrpfm.com`"],
        ["Proxy", "Cloudflare Tunnel → `localhost:3000`"],
        ["Default GUILD_ID", "`1457188814916423855`"],
        ["Game Affairs role ID", "`1457189093594239147`"],
      ] } },
      { note: { tone: "info", text: "This page is visible only to L3 — FM Leadership and Game Affairs Management. Hand it, the `.env`, the Discord app ownership, and the Cloudflare account access to whoever takes over. Losing the Cloudflare tunnel credentials or the Discord app ownership is the hardest part to recover, so transfer those deliberately." } },
    ],
  },
];

function Block({ b }) {
  if (b.p) return <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.75, margin: "10px 0" }}>{md(b.p)}</p>;
  if (b.code) return <CodeBlock code={b.code} />;
  if (b.note) return <Note tone={b.note.tone}>{md(b.note.text)}</Note>;
  if (b.table) return <Table head={b.table.head} rows={b.table.rows} />;
  if (b.ul) return (
    <ul style={{ margin: "10px 0", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 6 }}>
      {b.ul.map((li, i) => <li key={i} style={{ fontSize: 13.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.65 }}>{md(li)}</li>)}
    </ul>
  );
  return null;
}

// ── Database export ──────────────────────────────────────────────────────────
const PREVIEW_CAP = 5000; // inline copy box shows up to this many rows; download always gives all

function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function CopyBtn({ text, label = "Copy", style }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch {} }}
      style={{ fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
        border: "1px solid rgba(255,255,255,0.12)", background: done ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.05)", color: done ? "#34d399" : "rgba(255,255,255,0.6)", ...style }}>
      {done ? "COPIED" : label}
    </button>
  );
}

function TableRow({ t }) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("csv");
  const [data, setData] = useState(null);      // { text, returned, total, cols }
  const [busy, setBusy] = useState(false);
  const [dl, setDl] = useState(false);

  const load = async (fmt) => {
    setBusy(true);
    try { setData(await getTableExport(t.name, fmt, PREVIEW_CAP)); } catch (e) { setData({ text: "-- error: " + (e.message || e), returned: 0, total: t.rows }); }
    setBusy(false);
  };
  const toggle = () => { const next = !open; setOpen(next); if (next && !data) load(format); };
  const switchFmt = (fmt) => { setFormat(fmt); load(fmt); };
  const doDownload = async () => {
    setDl(true);
    try {
      const full = await getTableExport(t.name, format, 0); // 0 = all rows
      downloadText(`${t.name}.${format}`, full.text, format === "json" ? "application/json" : "text/csv");
    } catch {}
    setDl(false);
  };

  const truncated = data && data.total > data.returned;

  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, background: "rgba(255,255,255,0.02)", overflow: "hidden" }}>
      <button onClick={toggle} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 12px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
        <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, width: 12, marginTop: 2, flexShrink: 0 }}>{open ? "▾" : "▸"}</span>
        <span style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{t.name}</span>
            <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.4)", fontFamily: "JetBrains Mono, monospace" }}>{t.rows.toLocaleString()} row{t.rows === 1 ? "" : "s"}</span>
            {t.redacted && <span style={{ fontSize: 9, fontWeight: 700, color: "#f87171", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", padding: "1px 6px", borderRadius: 4, fontFamily: "JetBrains Mono, monospace" }}>TOKENS REDACTED</span>}
          </span>
          {TABLE_DOCS[t.name] && <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.45 }}>{TABLE_DOCS[t.name]}</span>}
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
            {["csv", "json"].map((f) => (
              <button key={f} onClick={() => switchFmt(f)} disabled={busy} style={{ fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "JetBrains Mono, monospace",
                border: `1px solid ${format === f ? "rgba(129,140,248,0.4)" : "rgba(255,255,255,0.12)"}`, background: format === f ? "rgba(99,102,241,0.15)" : "transparent", color: format === f ? "#a5b4fc" : "rgba(255,255,255,0.5)" }}>{f.toUpperCase()}</button>
            ))}
            {data && <CopyBtn text={data.text} />}
            <button onClick={doDownload} disabled={dl} style={{ fontSize: 10.5, fontWeight: 700, padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontFamily: "JetBrains Mono, monospace", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)" }}>{dl ? "…" : `DOWNLOAD .${format.toUpperCase()}`}</button>
            {truncated && <span style={{ fontSize: 10.5, color: "#fbbf24" }}>preview capped at {PREVIEW_CAP.toLocaleString()} of {data.total.toLocaleString()} — download for all</span>}
          </div>
          {busy && !data ? <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", padding: "8px 0" }}>Loading…</div> : data && (
            <pre style={{ margin: 0, padding: "12px 14px", borderRadius: 8, maxHeight: 320, overflow: "auto", background: "#0c0c12", border: "1px solid rgba(255,255,255,0.08)", fontFamily: "JetBrains Mono, monospace", fontSize: 11.5, lineHeight: 1.55, color: "#d4d4e0", whiteSpace: "pre" }}>{data.text || "(empty)"}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function GroupLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", fontFamily: "JetBrains Mono, monospace", margin: "0 0 8px" }}>{children}</div>;
}

function DatabaseExport() {
  const [tables, setTables] = useState(null);
  const [filter, setFilter] = useState("");
  const [dump, setDump] = useState("");        // which bundle is generating
  const [showExcluded, setShowExcluded] = useState(false);

  useEffect(() => { listTables().then(setTables).catch(() => setTables([])); }, []);

  const fullDump = async (format) => {
    setDump(format);
    try {
      const text = await getFullDump(format);  // core scope (transient excluded)
      downloadText(`meridian-handover.${format === "sql" ? "sql" : "json"}`, text, format === "sql" ? "application/sql" : "application/json");
    } catch (e) { alert("Export failed: " + (e.message || e)); }
    setDump("");
  };

  const match = (t) => t.name.toLowerCase().includes(filter.toLowerCase());
  const core = (tables || []).filter((t) => t.core && match(t));
  const excluded = (tables || []).filter((t) => !t.core && match(t));
  const coreCount = (tables || []).filter((t) => t.core).length;
  const coreRows = (tables || []).filter((t) => t.core).reduce((a, t) => a + t.rows, 0);

  return (
    <div>
      <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.75, margin: "10px 0" }}>
        {md("This is where the data lives. Each table below is a spreadsheet of one kind of information, with a **plain-English note explaining what it holds**. This is a live, read-only export of the **transition-critical** data — factions & history (**including archived**), properties, NPCs, scene logs, arsenal, inventory, fleet, treasury, staff, config, documents & knowledge base — so it survives even if the website is switched off. Everyday clutter (pings, tasks, reminders, message/audit logs, logins) is **left out of the download** and tucked below.")}
      </p>
      <Note tone="warn">{md("This reads the database **at the moment you click** — regenerate right before handoff so it's current. Live session tokens (`sessions.token`, `mdb_sessions.token`) are redacted.")}</Note>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "16px 0 6px" }}>
        <button onClick={() => fullDump("sql")} disabled={!!dump} style={{ fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8, cursor: "pointer", border: "none", background: "rgba(99,102,241,0.85)", color: "#fff", opacity: dump ? 0.5 : 1 }}>
          {dump === "sql" ? "Generating…" : "⬇ Handover data — SQL"}
        </button>
        <button onClick={() => fullDump("json")} disabled={!!dump} style={{ fontSize: 12, fontWeight: 700, padding: "8px 14px", borderRadius: 8, cursor: "pointer", border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "rgba(255,255,255,0.7)", opacity: dump ? 0.5 : 1 }}>
          {dump === "json" ? "Generating…" : "⬇ Handover data — JSON"}
        </button>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>
          {tables ? `${coreCount} core tables · ${coreRows.toLocaleString()} rows` : "loading…"}
        </span>
      </div>
      <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)", margin: "0 0 16px", lineHeight: 1.6 }}>
        {md("The bundle includes **only** the transition data below. **SQL** rebuilds it anywhere: `sqlite3 restored.db < meridian-handover.sql`. **JSON** is `{ tables: { name: [rows] } }`. Need a specific transient table too? Expand it below and download it on its own.")}
      </p>

      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter tables… (e.g. properties, npcs, scene_logs, faction_history)"
        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, boxSizing: "border-box", marginBottom: 14, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)", color: "#e2e8f0", fontSize: 13, outline: "none" }} />

      {!tables ? <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", padding: "8px 0" }}>Loading tables…</div> : (
        <>
          <GroupLabel>Included in handover — {core.length} table{core.length === 1 ? "" : "s"}</GroupLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {core.map((t) => <TableRow key={t.name} t={t} />)}
            {core.length === 0 && <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", padding: "4px 0" }}>No included tables match “{filter}”.</div>}
          </div>

          {excluded.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <button onClick={() => setShowExcluded((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 8 }}>
                <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11 }}>{showExcluded ? "▾" : "▸"}</span>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", fontFamily: "JetBrains Mono, monospace" }}>
                  Excluded — transient &amp; logs · {excluded.length} · not in the bundle
                </span>
              </button>
              {showExcluded && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: 0.7 }}>
                  {excluded.map((t) => <TableRow key={t.name} t={t} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function HandoverPage() {
  const auth = useAuth();
  const canAccess = !auth.loading && auth.level >= 3;

  if (auth.loading) return <div style={{ padding: "60px 24px", textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>Loading…</div>;
  if (!canAccess) return <div style={{ padding: "60px 24px", textAlign: "center", color: "rgba(255,255,255,0.4)", fontSize: 13 }}>Leadership access (L3) required.</div>;

  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "12px 16px 80px" }}>
      <div style={{ marginBottom: 8 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.02em", margin: 0 }}>Server Handover Runbook</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", margin: "6px 0 0", lineHeight: 1.6 }}>
          {md("Written so **anyone can follow it** — no technical background assumed. It does two things: keep every piece of faction data safe forever, and let a tech-savvy helper put the whole system back up if you want to keep it running. **Begin with “Start here” below.** Restricted to **FM Leadership** and **Game Affairs Management**.")}
        </p>
      </div>

      {/* contents */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0 26px", padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)" }}>
        {RUNBOOK.map((s) => (
          <a key={s.id} href={`#${s.id}`} style={{ fontSize: 11.5, fontWeight: 600, color: "#a5b4fc", textDecoration: "none", padding: "3px 9px", borderRadius: 6, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
            {s.title}
          </a>
        ))}
        <a href="#dbexport" style={{ fontSize: 11.5, fontWeight: 600, color: "#a5b4fc", textDecoration: "none", padding: "3px 9px", borderRadius: 6, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
          12 · Database export
        </a>
      </div>

      {RUNBOOK.map((s) => (
        <section key={s.id} id={s.id} style={{ scrollMarginTop: 20, marginBottom: 30 }}>
          <h2 style={{ fontSize: 16.5, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.01em", margin: "0 0 4px", paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{s.title}</h2>
          {s.blocks.map((b, i) => <Block key={i} b={b} />)}
        </section>
      ))}

      <section id="dbexport" style={{ scrollMarginTop: 20, marginBottom: 30 }}>
        <h2 style={{ fontSize: 16.5, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.01em", margin: "0 0 4px", paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>12 · Database export (transition data)</h2>
        <DatabaseExport />
      </section>
    </div>
  );
}
