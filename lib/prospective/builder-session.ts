/**
 * Identity of ONE proposal-builder session in the vendor Prospective
 * workspace (/vendor/prospective → Proposals).
 *
 * Why this exists (Charles 2026-07-27 "after creating a proposal it should be
 * able to be saved and you can go back and look at it again"): the one-page
 * workspace keeps a single <ProposalBuilder> mounted for the whole visit. The
 * builder remembers the row its last save created so a SECOND save updates
 * that row instead of minting a duplicate draft — correct inside one session,
 * silent data loss across two. "New proposal" reused the mounted builder AND
 * its stale bound id, so the next save called updateProposal on the proposal
 * the vendor had just finished, overwriting it instead of creating a second.
 *
 * The fix is the CLAUDE.md "reset state with a key prop, not an effect" rule:
 * the workspace derives a session key from (proposal being edited, new-proposal
 * nonce) and hands it to the builder as `key`. A new session = a new key = a
 * remount = a fresh bound id, with no reset effect anyone can forget to fire.
 *
 * Both halves live here so the create-vs-update decision and the remount key
 * that resets it can be reasoned about — and tested — together.
 */

/** Session-key segment for "not editing anything saved yet". */
export const NEW_PROPOSAL_SESSION = "new"

/**
 * The remount key for a builder session. `sessionNonce` is a monotonically
 * increasing counter owned by the workspace and bumped on "New proposal";
 * `editingProposalId` covers opening a different saved proposal without one.
 */
export function builderSessionKey(
  editingProposalId: string | null | undefined,
  sessionNonce: number,
): string {
  return `${editingProposalId ?? NEW_PROPOSAL_SESSION}:${sessionNonce}`
}

/** Where a builder save lands: an in-place update, or a brand-new draft. */
export type ProposalPersistTarget =
  | { mode: "update"; proposalId: string }
  | { mode: "create" }

/**
 * Resolve the row a save writes to. `editingProposalId` is the proposal the
 * workspace opened for editing; `boundProposalId` is the row THIS builder
 * session already created (its own prior save). Neither → create.
 *
 * Note the ordering is not load-bearing: once a session has persisted, both
 * ids describe the same row (the builder binds `boundProposalId`
 * unconditionally, so the bound row lives in exactly one place).
 */
export function resolveProposalPersistTarget(
  editingProposalId: string | null | undefined,
  boundProposalId: string | null | undefined,
): ProposalPersistTarget {
  const proposalId = editingProposalId ?? boundProposalId ?? null
  return proposalId ? { mode: "update", proposalId } : { mode: "create" }
}
