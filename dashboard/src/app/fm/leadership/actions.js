"use server";
import { query, queryOne, run } from "../../../lib/db.js";
import { getRole } from "../../../lib/discord.js";
import { sendPing } from "../../../lib/pings.js";
import { logAudit } from "../../../lib/audit.js";
import { requireActor } from "../../../lib/requireActor.js";

// All leadership actions require L2+ (Team Leads and Leadership only).
// Identity and team scope are derived server-side from the session.

async function getAccessibleFactions(userId, userLevel, isLst = false) {
  // L3 and Lead Storytellers work with every faction → all of them, not team-scoped.
  if (userLevel >= 3 || isLst) {
    return query("SELECT * FROM factions WHERE archived = 0 ORDER BY name");
  }
  const user = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [userId]);
  if (!user || !user.team_id) return [];
  return query(`SELECT f.* FROM factions f
    JOIN staff s ON f.lead_discord_id = s.discord_id
    WHERE f.archived = 0 AND s.team_id = ?
    ORDER BY f.name`, [user.team_id]);
}

// ══════════════════════════════════════════════
// REVIEWS TAB
// ══════════════════════════════════════════════
export async function getReviewData() {
  const actor = await requireActor(2);
  // All team leads can view every faction's review; editing stays scoped to
  // own-team factions (enforced server-side in submitReview / editReview).
  const factions = query("SELECT * FROM factions WHERE archived = 0 ORDER BY name");
  const me = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [actor.id]);
  const myTeamId = me?.team_id || null;
  const currentMonth = new Date().toISOString().substring(0, 7);
  const isLeadership = actor.level >= 3 && actor.rank === 'Management';

  return factions.map(f => {
    const scenes30 = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE faction_id = ? AND created_at >= datetime('now', '-30 days')", [f.id])?.c || 0;
    const scenes60 = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE faction_id = ? AND created_at >= datetime('now', '-60 days') AND created_at < datetime('now', '-30 days')", [f.id])?.c || 0;
    const scenes90 = queryOne("SELECT COUNT(*) as c FROM scene_logs WHERE faction_id = ? AND created_at >= datetime('now', '-90 days') AND created_at < datetime('now', '-60 days')", [f.id])?.c || 0;
    const noteCount = queryOne("SELECT COUNT(*) as c FROM intel_notes WHERE faction_id = ? AND created_at >= datetime('now', '-30 days')", [f.id])?.c || 0;
    const recentHistory = query("SELECT action_type, details, created_at FROM faction_history WHERE faction_id = ? ORDER BY created_at DESC LIMIT 5", [f.id]);
    const existingReview = queryOne("SELECT * FROM faction_reviews WHERE faction_id = ? AND review_month = ?", [f.id, currentMonth]);
    const lead = queryOne("SELECT display_name, team_name, team_id FROM staff WHERE discord_id = ?", [f.lead_discord_id]);
    const hasMyNote = isLeadership
      ? !!queryOne("SELECT id FROM leadership_personal_notes WHERE faction_id=? AND author_id=? AND review_month=?", [f.id, actor.id, currentMonth])
      : null;

    return {
      id: f.id,
      name: f.name,
      tier: f.tier,
      teamName: lead?.team_name || '',
      leadName: lead?.display_name || '',
      mine: !!(myTeamId && lead?.team_id && lead.team_id === myTeamId),
      scenes30, scenes60, scenes90,
      forumPosts: f.forum_posts_30d || 0,
      noteCount,
      lastPromoted: f.last_promoted || 'Never',
      recentHistory,
      currentReview: existingReview || null,
      hasMyNote,
    };
  });
}

export async function getReviewHistory(factionId) {
  await requireActor(2);
  // Review history is viewable by any team lead (editing stays scoped elsewhere).
  return query("SELECT * FROM faction_reviews WHERE faction_id = ? ORDER BY review_month DESC LIMIT 12", [factionId]);
}

export async function submitReview(data) {
  const actor = await requireActor(2);
  // Verify the faction is accessible
  const accessible = await getAccessibleFactions(actor.id, actor.level);
  if (!accessible.find(f => f.id === data.factionId)) {
    return { ok: false, error: "Faction not in your scope" };
  }

  const currentMonth = new Date().toISOString().substring(0, 7);
  const existing = queryOne("SELECT id FROM faction_reviews WHERE faction_id = ? AND review_month = ?", [data.factionId, currentMonth]);

  const isNew = !existing;
  if (existing) {
    run("UPDATE faction_reviews SET recommendation=?, feedback=?, status='Pending Discussion', updated_at=datetime('now') WHERE id=?",
      [data.recommendation, data.feedback, existing.id]);
    logAudit(actor.id, actor.name, 'EDIT', 'review', existing.id, data.factionName, data.recommendation);
  } else {
    run("INSERT INTO faction_reviews (faction_id, faction_name, review_month, recommendation, feedback, reviewer_id, reviewer_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending Discussion')",
      [data.factionId, data.factionName, currentMonth, data.recommendation, data.feedback, actor.id, actor.name]);
    logAudit(actor.id, actor.name, 'CREATE', 'review', null, data.factionName, data.recommendation);
  }

  // Only ping on first submission, not every save
  if (isNew) {
    const faction = queryOne("SELECT lead_discord_id FROM factions WHERE id = ?", [data.factionId]);
    if (faction?.lead_discord_id) {
      await sendPing('review.submitted',
        `<@${faction.lead_discord_id}> 📋 Feedback has been submitted for **${data.factionName}** for this month. Please incorporate it into your message to the faction on the 15th.\n<https://ecrpfm.com/fm/leadership/reviews>`
      );
    }
  }

  return { ok: true };
}

export async function editReview(reviewId, data) {
  const actor = await requireActor(2);
  const review = queryOne("SELECT * FROM faction_reviews WHERE id = ?", [reviewId]);
  if (!review) return { ok: false, error: 'Review not found.' };
  if (review.reviewer_id !== actor.id && actor.level < 3) return { ok: false, error: 'Not your review.' };
  run("UPDATE faction_reviews SET recommendation=?, feedback=?, updated_at=datetime('now') WHERE id=?",
    [data.recommendation, data.feedback, reviewId]);
  logAudit(actor.id, actor.name, 'EDIT', 'review', reviewId, review.faction_name, data.recommendation);
  return { ok: true };
}

export async function deleteReview(reviewId) {
  const actor = await requireActor(2);
  const review = queryOne("SELECT * FROM faction_reviews WHERE id = ?", [reviewId]);
  if (!review) return { ok: false, error: 'Review not found.' };
  if (review.reviewer_id !== actor.id && actor.level < 3) return { ok: false, error: 'Not your review.' };
  run("DELETE FROM faction_reviews WHERE id = ?", [reviewId]);
  logAudit(actor.id, actor.name, 'DELETE', 'review', reviewId, review.faction_name, '');
  return { ok: true };
}

export async function setReviewStatus(reviewId, status) {
  const actor = await requireActor(2);
  const review = queryOne("SELECT faction_name FROM faction_reviews WHERE id = ?", [reviewId]);
  if (!review) return { ok: false };
  run("UPDATE faction_reviews SET status=?, updated_at=datetime('now') WHERE id=?", [status, reviewId]);
  logAudit(actor.id, actor.name, 'EDIT', 'review', reviewId, review.faction_name, 'Status: ' + status);
  return { ok: true };
}

// ══════════════════════════════════════════════
// PERSONAL LEADERSHIP NOTES (L3 only)
// ══════════════════════════════════════════════

export async function getFactionLeadershipSummary(factionId) {
  await requireActor(2);
  const currentMonth = new Date().toISOString().substring(0, 7);
  const leaders = query("SELECT discord_id, display_name FROM staff WHERE clearance >= 3 AND rank = 'Management' ORDER BY display_name");
  const notes = query(
    "SELECT * FROM leadership_personal_notes WHERE faction_id = ? AND review_month = ? ORDER BY created_at ASC",
    [factionId, currentMonth]
  );
  const submittedIds = new Set(notes.map(n => n.author_id));
  const pending = leaders.filter(l => !submittedIds.has(l.discord_id));
  return { notes, pending };
}

export async function getMyPersonalNotes(factionId) {
  const actor = await requireActor(3);
  return query(
    "SELECT * FROM leadership_personal_notes WHERE faction_id = ? AND author_id = ? ORDER BY created_at DESC",
    [factionId, actor.id]
  );
}

export async function getAllLeadershipNotes(factionId) {
  await requireActor(3);
  return query(
    "SELECT * FROM leadership_personal_notes WHERE faction_id = ? ORDER BY created_at DESC",
    [factionId]
  );
}

export async function submitPersonalNote(factionId, factionName, note, status) {
  const actor = await requireActor(3);
  if (!note?.trim()) return { ok: false, error: 'Note is empty.' };
  const currentMonth = new Date().toISOString().substring(0, 7);
  run(
    "INSERT INTO leadership_personal_notes (faction_id, faction_name, author_id, author_name, review_month, note, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [factionId, factionName, actor.id, actor.name, currentMonth, note.trim(), status || '']
  );
  // Also sync status to the faction_reviews row so it shows on the row header
  if (status) {
    const existing = queryOne("SELECT id FROM faction_reviews WHERE faction_id=? AND review_month=?", [factionId, currentMonth]);
    if (existing) run("UPDATE faction_reviews SET status=?, updated_at=datetime('now') WHERE id=?", [status, existing.id]);
  }
  logAudit(actor.id, actor.name, 'CREATE', 'leadership_note', null, factionName, (status ? status + ' — ' : '') + note.substring(0, 80));
  const faction = queryOne("SELECT lead_discord_id FROM factions WHERE id=?", [factionId]);
  let msg = `📝 **Leadership feedback has been submitted for ${factionName}.** Please review it before the 15th.\n<https://ecrpfm.com/fm/leadership/reviews>`;
  if (faction?.lead_discord_id) msg = `<@${faction.lead_discord_id}> ` + msg;
  await sendPing('review.leadership_note', msg);
  return { ok: true };
}

export async function editPersonalNote(noteId, note, status) {
  const actor = await requireActor(3);
  const existing = queryOne("SELECT * FROM leadership_personal_notes WHERE id=? AND author_id=?", [noteId, actor.id]);
  if (!existing) return { ok: false, error: 'Note not found or not yours.' };
  run("UPDATE leadership_personal_notes SET note=?, status=? WHERE id=?", [note.trim(), status || '', noteId]);
  // Sync status to faction_reviews if changed
  if (status && status !== existing.status) {
    const rev = queryOne("SELECT id FROM faction_reviews WHERE faction_id=? AND review_month=?", [existing.faction_id, existing.review_month]);
    if (rev) run("UPDATE faction_reviews SET status=?, updated_at=datetime('now') WHERE id=?", [status, rev.id]);
    const faction = queryOne("SELECT lead_discord_id FROM factions WHERE id=?", [existing.faction_id]);
    let msg = `📝 **Leadership feedback has been updated for ${existing.faction_name}.** Please review it before the 15th.\n<https://ecrpfm.com/fm/leadership/reviews>`;
    if (faction?.lead_discord_id) msg = `<@${faction.lead_discord_id}> ` + msg;
    await sendPing('review.leadership_note', msg);
  }
  logAudit(actor.id, actor.name, 'EDIT', 'leadership_note', noteId, existing.faction_name, (status || '') + ' — ' + note.substring(0, 80));
  return { ok: true };
}

// ══════════════════════════════════════════════
// AI FEEDBACK DRAFT + SEND TO FACTION
// ══════════════════════════════════════════════

export async function generateFeedbackDraft(factionId) {
  const actor = await requireActor(2);

  const accessible = await getAccessibleFactions(actor.id, actor.level);
  const faction = accessible.find(f => f.id === factionId);
  if (!faction) return { ok: false, error: 'Faction not in your scope.' };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: 'OpenAI API key not configured.' };

  const currentMonth = new Date().toISOString().substring(0, 7);

  const review = queryOne(
    "SELECT recommendation, feedback FROM faction_reviews WHERE faction_id=? AND review_month=?",
    [factionId, currentMonth]
  );
  const notes = query(
    "SELECT author_name, note FROM leadership_personal_notes WHERE faction_id=? AND review_month=? ORDER BY created_at",
    [factionId, currentMonth]
  );

  if (!review?.feedback?.trim() && notes.length === 0) {
    return { ok: false, error: 'No feedback or leadership notes found for this faction yet. Write your review first.' };
  }

  const scenes30 = queryOne(
    "SELECT COUNT(*) as c FROM scene_logs WHERE faction_id=? AND created_at >= datetime('now','-30 days')",
    [factionId]
  )?.c || 0;
  const forumPosts = queryOne("SELECT forum_posts_30d FROM factions WHERE id=?", [factionId])?.forum_posts_30d || 0;

  const threadStatus = forumPosts === 0
    ? 'NO posts in the last 30 days — NOT meeting faction thread guidelines (demotion risk)'
    : forumPosts < 3
    ? `${forumPosts} post(s) in the last 30 days — faction thread activity is low`
    : `${forumPosts} posts in the last 30 days — faction thread is active`;

  const lines = [
    `Faction: ${faction.name} (Tier ${faction.tier})`,
    `30-day scenes: ${scenes30}`,
    `Faction thread activity: ${threadStatus}`,
  ];
  if (review) {
    lines.push(`\nTeam Lead Recommendation: ${review.recommendation}`);
    if (review.feedback?.trim()) lines.push(`Team Lead Feedback:\n${review.feedback.trim()}`);
  }
  if (notes.length > 0) {
    lines.push('\nFM Leadership Notes:');
    notes.forEach(n => lines.push(`- ${n.author_name}: ${n.note}`));
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a writer for Faction Management in a GTA RP server. You help craft casual, direct feedback messages to send to faction leads. Write from the perspective of Faction Management as a team — never use "I", always use "we" or "FM". Start the message with "Hello [Faction Name]." on its own line, then continue from there. Write in plain paragraphs only — no markdown, no asterisks, no bullet dashes. Keep it 2–4 paragraphs, under 300 words. Be conversational and straightforward, not corporate or overly formal. Be specific to the feedback provided. Always address faction thread activity — if the faction is not meeting thread guidelines, call it out clearly and explain it is a demotion factor. If they are meeting it, acknowledge it.',
          },
          {
            role: 'user',
            content: `Draft a message from Faction Management to send to this faction lead. Open with "Hello [Faction Name]." — replace [Faction Name] with the actual faction name. Keep the tone casual and direct. Always include a comment on their faction thread activity based on the data provided. Reference specific feedback points, give actionable suggestions where relevant, and write as if FM is speaking collectively.\n\n${lines.join('\n')}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.error?.message || `OpenAI error ${res.status}` };
    }
    const json = await res.json();
    const draft = json.choices?.[0]?.message?.content?.trim();
    if (!draft) return { ok: false, error: 'No response from AI.' };
    return { ok: true, draft };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function adjustFeedbackDraft(factionId, currentMessage, instruction) {
  const actor = await requireActor(2);
  if (!currentMessage?.trim()) return { ok: false, error: 'No message to adjust.' };
  if (!instruction?.trim()) return { ok: false, error: 'Please provide an adjustment instruction.' };

  const accessible = await getAccessibleFactions(actor.id, actor.level);
  if (!accessible.find(f => f.id === factionId)) return { ok: false, error: 'Faction not in your scope.' };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: 'OpenAI API key not configured.' };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a writer for Faction Management in a GTA RP server. You adjust existing feedback messages based on instructions. Write from FM\'s perspective — never use "I", always use "we" or "FM". Keep the opening greeting intact. Write in plain paragraphs only — no markdown, no asterisks, no bullet dashes. Preserve the tone and structure unless the instruction says otherwise.',
          },
          {
            role: 'user',
            content: `Adjust the following feedback message based on this instruction: "${instruction.trim()}"\n\nCurrent message:\n${currentMessage.trim()}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, error: err.error?.message || `OpenAI error ${res.status}` };
    }
    const json = await res.json();
    const draft = json.choices?.[0]?.message?.content?.trim();
    if (!draft) return { ok: false, error: 'No response from AI.' };
    return { ok: true, draft };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function sendFeedbackToFaction(factionId, message) {
  const actor = await requireActor(2);
  if (!message?.trim()) return { ok: false, error: 'Message is empty.' };

  const accessible = await getAccessibleFactions(actor.id, actor.level);
  if (!accessible.find(f => f.id === factionId)) {
    return { ok: false, error: 'Faction not in your scope.' };
  }

  const faction = queryOne("SELECT name FROM factions WHERE id=?", [factionId]);
  if (!faction) return { ok: false, error: 'Faction not found.' };

  const config = queryOne(
    "SELECT comms_channel_id FROM bot_server_configs WHERE faction_id=?",
    [factionId]
  );
  if (!config?.comms_channel_id) {
    return { ok: false, error: `${faction.name} has no comms channel configured.` };
  }

  const botToken = process.env.DISCORD_BOT_TOKEN;
  if (!botToken) return { ok: false, error: 'Bot token not configured.' };

  const monthName = new Date().toLocaleString('en-US', { month: 'long' });
  const embed = {
    title: `Monthly Feedback - ${monthName}`,
    description: message.trim(),
    color: 0xa07ef5,
    footer: { text: `Sent by ${actor.name}` },
    timestamp: new Date().toISOString(),
  };

  const res = await fetch(
    `https://discord.com/api/v10/channels/${config.comms_channel_id}/messages`,
    {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    }
  );

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const detail = errBody.message || `HTTP ${res.status}`;
    return { ok: false, error: `Discord delivery failed: ${detail}` };
  }

  run(
    "INSERT INTO faction_public_messages (faction_id, faction_name, author_name, author_id, message, is_pinned) VALUES (?, ?, ?, ?, ?, 0)",
    [factionId, faction.name, actor.name, actor.id, message.trim()]
  );

  // Notify FM Leadership that feedback has been delivered
  await sendPing('review.feedback_sent',
    `📨 **${actor.name}** has sent the monthly feedback message to **${faction.name}** via Faction Management comms.`
  );

  logAudit(actor.id, actor.name, 'CREATE', 'feedback_sent', null, faction.name, message.trim().substring(0, 100));
  return { ok: true };
}

export async function markFeedbackSent(factionId) {
  const actor = await requireActor(2);
  const accessible = await getAccessibleFactions(actor.id, actor.level);
  if (!accessible.find(f => f.id === factionId)) return { ok: false, error: 'Faction not in your scope.' };
  const faction = queryOne("SELECT name FROM factions WHERE id=?", [factionId]);
  if (!faction) return { ok: false, error: 'Faction not found.' };
  await sendPing('review.feedback_sent', `📨 **${actor.name}** has marked feedback as sent to **${faction.name}** (delivered manually outside the dashboard).`);
  logAudit(actor.id, actor.name, 'CREATE', 'feedback_sent', null, faction.name, 'Marked as sent manually');
  return { ok: true };
}

// ══════════════════════════════════════════════
// QUEUE TAB
// ══════════════════════════════════════════════
export async function getPendingQueue() {
  const actor = await requireActor(2, {allowLeadStoryteller: true});
  const factions = await getAccessibleFactions(actor.id, actor.level, actor.isLeadStoryteller);
  const factionIds = factions.map(f => f.id);
  if (factionIds.length === 0) return { rpChanges: [], deletions: [], promos: [] };

  const placeholders = factionIds.map(() => '?').join(',');

  const rpChanges = query(`SELECT e.*, f.name as faction_name FROM pending_executions e
    JOIN factions f ON e.faction_id = f.id
    WHERE e.faction_id IN (${placeholders}) AND e.status IN ('PENDING','APPROVED','RP_DONE')
    ORDER BY e.created_at DESC`, factionIds);

  const deletions = query(`SELECT d.* FROM deletion_requests d
    WHERE d.status = 'PENDING'
    ORDER BY d.created_at DESC LIMIT 50`);

  const promos = factions.filter(f => f.pending_promo).map(f => ({
    faction_id: f.id,
    faction_name: f.name,
    target_tier: f.pending_promo,
    current_tier: f.tier,
  }));

  return { rpChanges, deletions, promos };
}

// ══════════════════════════════════════════════
// PERFORMANCE TAB
// ══════════════════════════════════════════════
export async function getTeamPerformance() {
  const actor = await requireActor(2);
  let teamIds;
  if (actor.level >= 3) {
    teamIds = query("SELECT DISTINCT team_id, team_name FROM staff WHERE team_id != '' AND team_name != 'Game Affairs Management' ORDER BY team_name");
  } else {
    const user = queryOne("SELECT team_id, team_name FROM staff WHERE discord_id = ?", [actor.id]);
    if (!user || !user.team_id) return [];
    teamIds = [{ team_id: user.team_id, team_name: user.team_name }];
  }

  return teamIds.map(t => {
    const staff = query("SELECT * FROM staff WHERE team_id = ?", [t.team_id]);
    const factions = query("SELECT f.* FROM factions f JOIN staff s ON f.lead_discord_id = s.discord_id WHERE s.team_id = ? AND f.archived = 0", [t.team_id]);
    const factionIds = factions.map(f => f.id);

    let totalScenes30 = 0, totalScenes = 0, totalForum = 0;
    if (factionIds.length > 0) {
      const placeholders = factionIds.map(() => '?').join(',');
      totalScenes30 = queryOne(`SELECT COUNT(*) as c FROM scene_logs WHERE faction_id IN (${placeholders}) AND created_at >= datetime('now','-30 days')`, factionIds)?.c || 0;
      totalScenes = queryOne(`SELECT COUNT(*) as c FROM scene_logs WHERE faction_id IN (${placeholders})`, factionIds)?.c || 0;
      totalForum = factions.reduce((sum, f) => sum + (f.forum_posts_30d || 0), 0);
    }

    const staffIds = staff.map(s => s.discord_id);
    let openTasks = 0, completedTasks = 0;
    if (staffIds.length > 0) {
      const sph = staffIds.map(() => '?').join(',');
      openTasks = queryOne(`SELECT COUNT(*) as c FROM tasks WHERE target_id IN (${sph}) OR claimed_by IN (${sph})`, [...staffIds, ...staffIds])?.c || 0;
      completedTasks = queryOne(`SELECT COUNT(*) as c FROM task_log WHERE action = 'COMPLETED' AND actor IN (SELECT display_name FROM staff WHERE discord_id IN (${sph})) AND created_at >= datetime('now','-30 days')`, staffIds)?.c || 0;
    }

    const lead = staff.find(s => (s.rank || '').toLowerCase().includes('lead'));
    const guideCount = staff.filter(s => !(s.rank || '').toLowerCase().includes('lead')).length;

    return {
      teamId: t.team_id,
      teamName: t.team_name,
      leadName: lead?.display_name || 'Vacant',
      guideCount,
      factionCount: factions.length,
      scenes30: totalScenes30,
      scenesAll: totalScenes,
      forumPosts30: totalForum,
      openTasks,
      completedTasks,
      scenesPerFaction: factions.length > 0 ? (totalScenes30 / factions.length).toFixed(1) : '0',
    };
  });
}

// ══════════════════════════════════════════════
// GUIDE ACTIVITY TAB
// ══════════════════════════════════════════════
export async function getGuideActivity() {
  const actor = await requireActor(2);
  let staffList;
  if (actor.level >= 3) {
    staffList = query("SELECT * FROM staff WHERE discord_id != '' AND team_name != 'Game Affairs Management' ORDER BY team_name, rank, display_name");
  } else {
    const user = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [actor.id]);
    if (!user || !user.team_id) return [];
    staffList = query("SELECT * FROM staff WHERE team_id = ? AND discord_id != '' ORDER BY rank, display_name", [user.team_id]);
  }

  return staffList.map(s => {
    const scenes30 = queryOne(`
      SELECT COUNT(*) as c FROM (
        SELECT id FROM scene_logs WHERE author_id = ? AND created_at >= datetime('now','-30 days')
        UNION
        SELECT sl.id FROM scene_assistants sa JOIN scene_logs sl ON sa.scene_id = sl.id
        WHERE sa.staff_id = ? AND sl.created_at >= datetime('now','-30 days')
      )`, [s.discord_id, s.discord_id])?.c || 0;
    const scenes60 = queryOne(`
      SELECT COUNT(*) as c FROM (
        SELECT id FROM scene_logs WHERE author_id = ? AND created_at >= datetime('now','-60 days') AND created_at < datetime('now','-30 days')
        UNION
        SELECT sl.id FROM scene_assistants sa JOIN scene_logs sl ON sa.scene_id = sl.id
        WHERE sa.staff_id = ? AND sl.created_at >= datetime('now','-60 days') AND sl.created_at < datetime('now','-30 days')
      )`, [s.discord_id, s.discord_id])?.c || 0;
    const scenesAll = queryOne(`
      SELECT COUNT(*) as c FROM (
        SELECT id FROM scene_logs WHERE author_id = ?
        UNION
        SELECT sl.id FROM scene_assistants sa JOIN scene_logs sl ON sa.scene_id = sl.id WHERE sa.staff_id = ?
      )`, [s.discord_id, s.discord_id])?.c || 0;
    const notes30 = queryOne("SELECT COUNT(*) as c FROM intel_notes WHERE author = ? AND created_at >= datetime('now','-30 days')", [s.display_name])?.c || 0;
    const tasksCompleted = queryOne("SELECT COUNT(*) as c FROM task_log WHERE actor = ? AND action = 'COMPLETED' AND created_at >= datetime('now','-30 days')", [s.display_name])?.c || 0;

    return {
      id: s.discord_id,
      name: s.display_name,
      team: s.team_name || '',
      rank: s.rank || '',
      scenes30, scenes60, scenesAll,
      notes30,
      tasksCompleted,
    };
  });
}

// ══════════════════════════════════════════════
// MEETING NOTES TAB
// ══════════════════════════════════════════════
// A meeting note targets a faction (default), an FM team, or a staff group.
//   target_type 'faction' -> faction_id holds the faction; target_key ''
//   target_type 'team'    -> target_key = teams.team_id
//   target_type 'group'   -> target_key = one of NOTE_GROUPS below
// Staff groups are L3-only. `clause` is a constant SQL fragment (never user input).
const NOTE_GROUPS = {
  team_leads: { label: 'Team Leads',   clause: 'clearance = 2'        },
  management: { label: 'FM Management', clause: "rank = 'Management'"  },
  all_staff:  { label: 'All FM Staff',  clause: 'clearance >= 1'       },
};

// Can `actor` create/edit/delete a note for this target? Mirrors the read scope.
async function assertTargetInScope(actor, { targetType, factionId, targetKey }) {
  if (targetType === 'team') {
    if (!targetKey) return false;
    if (!queryOne("SELECT team_id FROM teams WHERE team_id = ?", [targetKey])) return false;
    if (actor.level >= 3) return true;
    const me = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [actor.id]);
    return !!me && me.team_id === targetKey;            // L2: own team only
  }
  if (targetType === 'group') {
    return actor.level >= 3 && !!NOTE_GROUPS[targetKey]; // groups are L3-only
  }
  // faction
  const id = parseInt(factionId);
  if (!id) return false;
  const accessible = await getAccessibleFactions(actor.id, actor.level);
  return !!accessible.find(f => f.id === id);
}

export async function getMeetingNotes() {
  const actor = await requireActor(1);
  const cols = `n.id, n.faction_id, n.date, n.author, n.author_id, n.text as content,
                n.created_at, n.meeting_type, n.target_type, n.target_key, n.target_label,
                n.attendees_json, f.name as faction_name`;
  let rows;
  if (actor.level >= 3) {
    rows = query(`SELECT ${cols} FROM ooc_notes n
      LEFT JOIN factions f ON n.faction_id = f.id
      WHERE n.target_type != 'faction' OR f.archived = 0
      ORDER BY n.created_at DESC LIMIT 100`);
  } else {
    const user = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [actor.id]);
    if (!user || !user.team_id) return [];
    rows = query(`SELECT ${cols} FROM ooc_notes n
      LEFT JOIN factions f ON n.faction_id = f.id
      LEFT JOIN staff s ON f.lead_discord_id = s.discord_id
      WHERE (n.target_type = 'faction' AND f.archived = 0 AND s.team_id = ?)
         OR (n.target_type = 'team' AND n.target_key = ?)
      ORDER BY n.created_at DESC LIMIT 100`, [user.team_id, user.team_id]);
  }
  return rows.map(n => {
    let attendeeIds = [];
    try { attendeeIds = JSON.parse(n.attendees_json || '[]'); } catch {}
    return {
      ...n,
      attendeeIds,
      display_name: n.target_type === 'faction'
        ? (n.faction_name || 'Unknown faction')
        : (n.target_label || 'Meeting'),
    };
  });
}

export async function saveMeetingNote(data) {
  const actor = await requireActor(1);
  const targetType = data.targetType || 'faction';
  const targetKey  = data.targetKey != null ? String(data.targetKey) : '';
  const factionId  = targetType === 'faction' ? (parseInt(targetKey) || null) : null;
  const storedKey  = targetType === 'faction' ? '' : targetKey;

  if (targetType === 'faction' && !factionId) return { ok: false, error: 'Faction is required' };
  if (targetType !== 'faction' && !targetKey) return { ok: false, error: 'A target is required' };

  if (!(await assertTargetInScope(actor, { targetType, factionId, targetKey }))) {
    return { ok: false, error: 'Target not in your scope' };
  }

  // Denormalized label for team/group notes (faction notes resolve their name via join)
  let targetLabel = '';
  if (targetType === 'team') {
    targetLabel = queryOne("SELECT team_name FROM teams WHERE team_id = ?", [targetKey])?.team_name || '';
  } else if (targetType === 'group') {
    targetLabel = NOTE_GROUPS[targetKey]?.label || '';
  }

  const attendees = JSON.stringify(Array.isArray(data.attendeeIds) ? data.attendeeIds : []);
  const today = new Date().toISOString().substring(0, 10);

  if (data.id) {
    const note = queryOne("SELECT faction_id, author_id, target_type, target_key FROM ooc_notes WHERE id = ?", [data.id]);
    if (!note) return { ok: false, error: 'Note not found' };
    // The note's existing target must also be in scope
    if (!(await assertTargetInScope(actor, { targetType: note.target_type, factionId: note.faction_id, targetKey: note.target_key }))) {
      return { ok: false, error: 'Note not in your scope' };
    }
    if (note.author_id !== actor.id && actor.level < 3) {
      return { ok: false, error: 'Only the author or L3 can edit' };
    }
    run("UPDATE ooc_notes SET faction_id=?, target_type=?, target_key=?, target_label=?, text=?, attendees_json=? WHERE id=?",
      [factionId, targetType, storedKey, targetLabel, data.content, attendees, data.id]);
    logAudit(actor.id, actor.name, 'EDIT', 'meeting_note', data.id, '', '');
  } else {
    run("INSERT INTO ooc_notes (faction_id, date, author, author_id, text, meeting_type, attendees_json, target_type, target_key, target_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [factionId, today, actor.name, actor.id, data.content,
       targetType === 'faction' ? 'faction_meeting' : `${targetType}_meeting`,
       attendees, targetType, storedKey, targetLabel]);
    logAudit(actor.id, actor.name, 'CREATE', 'meeting_note', null, '', '');
  }
  return { ok: true };
}

export async function deleteMeetingNote(id) {
  const actor = await requireActor(1);
  // Verify scope + author/L3 to delete
  const note = queryOne("SELECT id, faction_id, author_id, target_type, target_key FROM ooc_notes WHERE id = ?", [id]);
  if (!note) return { ok: false, error: "Note not found" };
  if (!(await assertTargetInScope(actor, { targetType: note.target_type, factionId: note.faction_id, targetKey: note.target_key }))) {
    return { ok: false, error: "Note not in your scope" };
  }
  if (note.author_id !== actor.id && actor.level < 3) {
    return { ok: false, error: "Only the author or L3 can delete" };
  }
  run("DELETE FROM ooc_notes WHERE id = ?", [id]);
  logAudit(actor.id, actor.name, 'DELETE', 'meeting_note', id, '', '');
  return { ok: true };
}

// Selectable targets for the Meeting Notes dropdown, scoped to the actor.
export async function getNoteTargets() {
  const actor = await requireActor(1);
  const factions = (await getAccessibleFactions(actor.id, actor.level))
    .map(f => ({ id: f.id, name: f.name }));

  let teams = [];
  if (actor.level >= 3) {
    teams = query("SELECT team_id, team_name FROM teams ORDER BY team_name");
  } else {
    const me = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [actor.id]);
    if (me?.team_id) {
      const t = queryOne("SELECT team_id, team_name FROM teams WHERE team_id = ?", [me.team_id]);
      if (t) teams = [t];                                  // L2: own team only
    }
  }

  const groups = actor.level >= 3
    ? Object.entries(NOTE_GROUPS).map(([key, g]) => ({ key, label: g.label }))
    : [];

  return { factions, teams, groups };
}

// Members to pre-fill the attendance list for a given target.
export async function getAttendeesForTarget(targetType, targetKey) {
  const actor = await requireActor(1);
  const type = targetType || 'faction';
  const key  = targetKey != null ? String(targetKey) : '';

  const inScope = await assertTargetInScope(actor, {
    targetType: type,
    factionId: type === 'faction' ? key : null,
    targetKey: key,
  });
  if (!inScope) return [];

  const members = (clause, params) => query(
    `SELECT discord_id, display_name, rank FROM staff
     WHERE ${clause} AND discord_id != '' AND discord_id NOT LIKE 'placeholder%'
     ORDER BY clearance DESC, display_name ASC`, params);

  if (type === 'team') return members('team_id = ?', [key]);
  if (type === 'group') {
    const g = NOTE_GROUPS[key];
    return g ? members(g.clause, []) : [];
  }
  // faction: members of the faction lead's team (existing behavior)
  const factionId = parseInt(key);
  if (!factionId) return [];
  const faction = queryOne("SELECT lead_discord_id FROM factions WHERE id = ?", [factionId]);
  if (!faction?.lead_discord_id) return [];
  const leadTeamId = queryOne("SELECT team_id FROM staff WHERE discord_id = ?", [faction.lead_discord_id])?.team_id;
  if (!leadTeamId) return [];
  return members('team_id = ?', [leadTeamId]);
}
