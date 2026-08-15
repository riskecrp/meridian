-- 014_feedback_reopen.sql
-- Completed / cancelled feedback can be reopened (Reopen button on the closing
-- message, and on the "already completed" reply any stale button gives).
--
-- Closing deletes the thread's card from #fm-feedback, and Discord offers no
-- way to restore a deleted message — so reopening posts a fresh card in the
-- channel linking the thread. Its message id lives here so closing the item
-- again takes that card down too, the same way the original card is removed.
ALTER TABLE faction_feedback ADD COLUMN reopen_card_id TEXT;
