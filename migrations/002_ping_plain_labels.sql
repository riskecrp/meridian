-- 002_ping_plain_labels.sql
-- Rewrites ping_routes.label into plain English written from the reader's point
-- of view ("Your task was claimed"), not the implementer's ("task.claimed.creator").
-- The route keys are unchanged; they are now shown only behind a Details toggle.

UPDATE ping_routes SET label = 'Someone is assigned a task'                  WHERE key = 'task.assigned';
UPDATE ping_routes SET label = 'A task is claimed'                           WHERE key = 'task.claimed.broadcast';
UPDATE ping_routes SET label = 'Your task was claimed'                       WHERE key = 'task.claimed.creator';
UPDATE ping_routes SET label = 'Your task was released'                      WHERE key = 'task.unclaimed.creator';
UPDATE ping_routes SET label = 'Your task was completed'                     WHERE key = 'task.completed.creator';
UPDATE ping_routes SET label = 'A task is reassigned'                        WHERE key = 'task.reassigned';
UPDATE ping_routes SET label = 'Your task was reassigned'                    WHERE key = 'task.reassigned.creator';
UPDATE ping_routes SET label = 'Someone asks about your task'                WHERE key = 'task.question.asked';
UPDATE ping_routes SET label = 'Your task question was answered'             WHERE key = 'task.question.answered';
UPDATE ping_routes SET label = 'Nudge about an unfinished task'              WHERE key = 'task.reminder.dm';

UPDATE ping_routes SET label = 'An event is scheduled'                       WHERE key = 'event.created';
UPDATE ping_routes SET label = 'Reminder — 30 minutes to go'                 WHERE key = 'reminder.warning';
UPDATE ping_routes SET label = 'Reminder — it''s time'                       WHERE key = 'reminder.due';
UPDATE ping_routes SET label = 'Monthly recurring reminder'                  WHERE key = 'reminder.recurring';

UPDATE ping_routes SET label = 'A faction is staged for promotion'           WHERE key = 'promo.staged';
UPDATE ping_routes SET label = 'A promotion is applied'                      WHERE key = 'promo.completed';
UPDATE ping_routes SET label = 'A staged promotion is cancelled'             WHERE key = 'promo.cancelled';
UPDATE ping_routes SET label = 'A faction is demoted'                        WHERE key = 'promo.demoted';
UPDATE ping_routes SET label = 'Monthly review thread and polls open'        WHERE key = 'promo.review.thread';
UPDATE ping_routes SET label = 'A monthly review is submitted'               WHERE key = 'review.submitted';
UPDATE ping_routes SET label = 'Leadership adds review feedback'             WHERE key = 'review.leadership_note';
UPDATE ping_routes SET label = 'Monthly feedback reaches the faction'        WHERE key = 'review.feedback_sent';

UPDATE ping_routes SET label = 'A team lead requests an RP change'           WHERE key = 'rp.requested';
UPDATE ping_routes SET label = 'A denied RP change is resubmitted'           WHERE key = 'rp.resubmitted';
UPDATE ping_routes SET label = 'The RP scene has been played out'            WHERE key = 'rp.done';
UPDATE ping_routes SET label = 'An RP change is applied'                     WHERE key = 'rp.executed';
UPDATE ping_routes SET label = 'Your RP change was approved'                 WHERE key = 'rp.approved.requester';
UPDATE ping_routes SET label = 'Your RP change was denied'                   WHERE key = 'rp.denied.requester';
UPDATE ping_routes SET label = 'Your RP change is live'                      WHERE key = 'rp.executed.requester';

UPDATE ping_routes SET label = 'Recognised Criminal Faction application'     WHERE key = 'form.rcf_application';
UPDATE ping_routes SET label = 'FM staff application'                        WHERE key = 'form.staff_application';
UPDATE ping_routes SET label = 'Garage request'                              WHERE key = 'form.garage_request';
UPDATE ping_routes SET label = 'CI application'                              WHERE key = 'form.ci_application';
UPDATE ping_routes SET label = 'Faction feedback — Criminal (FM)'            WHERE key = 'form.faction_feedback.fm';
UPDATE ping_routes SET label = 'Faction feedback — Legal (LFM)'              WHERE key = 'form.faction_feedback.lfm';

UPDATE ping_routes SET label = 'Announcement copied to FM'                   WHERE key = 'comms.announcement.fm';
UPDATE ping_routes SET label = 'IC message filed in the archive'             WHERE key = 'comms.ic.fm';

UPDATE ping_routes SET label = 'A doctor or drop location changes'           WHERE key = 'story.changelog';
UPDATE ping_routes SET label = 'Someone submits a scene idea'                WHERE key = 'story.scene_idea';
UPDATE ping_routes SET label = 'Feedback on your scene idea'                 WHERE key = 'story.scene_feedback';
UPDATE ping_routes SET label = 'Someone joins your scene log'                WHERE key = 'scene.assistant_added';

UPDATE ping_routes SET label = 'A new document is published'                 WHERE key = 'document.published';
UPDATE ping_routes SET label = 'Monthly FM hours report'                     WHERE key = 'fmhours.report.prod';
UPDATE ping_routes SET label = 'FM hours report (test mode)'                 WHERE key = 'fmhours.report.test';
UPDATE ping_routes SET label = 'Forum activity the bot watches'              WHERE key = 'forum.sync.source';
