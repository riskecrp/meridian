-- 009_checklist_detail_prereq.sql
-- The real RCF setup checklist arrived, and it needs two things the first cut
-- did not have.
--
-- `detail` — the steps are instructions, not labels. "Invite the Meridian bot"
-- fits on a button; the invite link it needs does not. So a step now carries a
-- short label for its button and the full text, links and all, for the embed.
--
-- `prereq` — the first three steps (join their Discord, invite the bot, create
-- the ECRP roles) are not merely first, they are load-bearing: none of the
-- remaining seven can physically be done until all three are. Marking them lets
-- the rest stay disabled until they are ticked, so the dependency is visible in
-- the UI rather than being something you have to already know.
--
-- Both are snapshotted per application alongside the label, for the same reason
-- the label is: editing the list later must not rewrite what an application in
-- flight is being held to.

ALTER TABLE form_submission_checklist ADD COLUMN detail TEXT NOT NULL DEFAULT '';
ALTER TABLE form_submission_checklist ADD COLUMN prereq INTEGER NOT NULL DEFAULT 0;
