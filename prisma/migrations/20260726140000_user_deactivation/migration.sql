-- Offboarding without destroying provenance.
--
-- audit_log.userId is RESTRICT, so a user who has performed audited actions
-- cannot be hard-deleted — the delete throws a raw FK error. More importantly,
-- deleting the actor behind a financial/PHI audit trail is the opposite of
-- what that trail is for. Deactivation blocks sign-in and revokes live
-- sessions while leaving the history intact.
ALTER TABLE "user" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
