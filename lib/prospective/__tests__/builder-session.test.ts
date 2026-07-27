import { describe, it, expect } from "vitest"

import {
  builderSessionKey,
  resolveProposalPersistTarget,
} from "@/lib/prospective/builder-session"

/**
 * Regression cover for the silent proposal overwrite (Charles 2026-07-27
 * "after creating a proposal it should be able to be saved and you can go back
 * and look at it again").
 *
 * The one-page workspace keeps ONE <ProposalBuilder> mounted for the visit, and
 * the builder binds the row its save created so a second save updates it
 * instead of minting a duplicate. "New proposal" reused that mounted builder
 * AND its stale binding, so the next save ran updateProposal on the proposal
 * just finished — one row where the vendor made two.
 *
 * The `simulateWorkspace` harness below is the workspace's own control flow
 * with the React parts stripped out: the session key decides when the builder
 * remounts (dropping its binding), and `resolveProposalPersistTarget` decides
 * create-vs-update. The load-bearing assertion is the LAST one in
 * "creating twice" — two distinct proposal ids, not one overwritten row.
 */

type SaveOutcome = { mode: "create" | "update"; proposalId: string }

/**
 * Minimal stand-in for the mounted builder + workspace. Mirrors
 * ProposalStepper (`key={builderSessionKey(editingProposalId, nonce)}`) and
 * ProposalBuilder (`createdIdRef`, bound unconditionally after a persist).
 */
function simulateWorkspace() {
  let nonce = 0
  let editingProposalId: string | null = null
  let mountedKey: string | null = null
  // The mounted builder's binding — dies with the builder it belongs to.
  let boundProposalId: string | null = null
  let nextId = 1

  const mountIfKeyChanged = () => {
    const key = builderSessionKey(editingProposalId, nonce)
    if (mountedKey === key) return
    mountedKey = key
    boundProposalId = null
  }

  return {
    /** "New proposal" — bumps the nonce, which remounts the builder. */
    newProposal() {
      editingProposalId = null
      nonce += 1
      mountIfKeyChanged()
    },
    /** Opening a saved proposal from the Opportunities card. */
    openSavedProposal(proposalId: string) {
      editingProposalId = proposalId
      mountIfKeyChanged()
    },
    /** One "Save proposal" / bridged "Analyze deal" commit. */
    save(): SaveOutcome {
      mountIfKeyChanged()
      const target = resolveProposalPersistTarget(
        editingProposalId,
        boundProposalId,
      )
      const proposalId =
        target.mode === "update" ? target.proposalId : `proposal-${nextId++}`
      boundProposalId = proposalId
      return { mode: target.mode, proposalId }
    },
    key: () => builderSessionKey(editingProposalId, nonce),
  }
}

describe("builderSessionKey", () => {
  it("changes when the vendor starts a new proposal", () => {
    expect(builderSessionKey(null, 0)).not.toBe(builderSessionKey(null, 1))
  })

  it("changes when a different saved proposal is opened", () => {
    expect(builderSessionKey("p1", 0)).not.toBe(builderSessionKey("p2", 0))
  })

  it("is stable while the same proposal stays open (no spurious remount)", () => {
    expect(builderSessionKey("p1", 3)).toBe(builderSessionKey("p1", 3))
    expect(builderSessionKey(null, 0)).toBe(builderSessionKey(undefined, 0))
  })

  it("distinguishes reopening the same proposal after a new-proposal detour", () => {
    // p1 → New → p1 again must remount, or the second visit inherits the
    // first visit's builder state.
    expect(builderSessionKey("p1", 0)).not.toBe(builderSessionKey("p1", 1))
  })
})

describe("resolveProposalPersistTarget", () => {
  it("creates when nothing is bound", () => {
    expect(resolveProposalPersistTarget(null, null)).toEqual({ mode: "create" })
  })

  it("updates the proposal opened for editing", () => {
    expect(resolveProposalPersistTarget("p1", null)).toEqual({
      mode: "update",
      proposalId: "p1",
    })
  })

  it("updates the row this session already created", () => {
    expect(resolveProposalPersistTarget(null, "p9")).toEqual({
      mode: "update",
      proposalId: "p9",
    })
  })
})

describe("proposal builder session — create / re-create / reopen", () => {
  it("creating twice produces TWO distinct proposals, not one overwritten row", () => {
    const ws = simulateWorkspace()

    ws.newProposal()
    const first = ws.save()
    expect(first.mode).toBe("create")

    // Same session, second click of Save: bound row is UPDATED, no duplicate.
    const firstAgain = ws.save()
    expect(firstAgain).toEqual({ mode: "update", proposalId: first.proposalId })

    // "New proposal" → a fresh session, a fresh builder, no binding.
    ws.newProposal()
    const second = ws.save()

    expect(second.mode).toBe("create")
    expect(second.proposalId).not.toBe(first.proposalId)
  })

  it("saving repeatedly inside one session never mints a duplicate draft", () => {
    const ws = simulateWorkspace()
    ws.newProposal()
    const created = ws.save()
    const outcomes = [ws.save(), ws.save(), ws.save()]

    expect(outcomes.every((o) => o.mode === "update")).toBe(true)
    expect(new Set(outcomes.map((o) => o.proposalId))).toEqual(
      new Set([created.proposalId]),
    )
  })

  it("reopening a saved proposal edits it in place — no second row", () => {
    const ws = simulateWorkspace()
    ws.newProposal()
    const created = ws.save()

    // Leave, come back via the Opportunities card.
    ws.newProposal()
    ws.openSavedProposal(created.proposalId)
    const reopened = ws.save()

    expect(reopened).toEqual({ mode: "update", proposalId: created.proposalId })
  })

  it("a new proposal started right after an edit does not overwrite the edited one", () => {
    const ws = simulateWorkspace()
    ws.openSavedProposal("existing-1")
    const edited = ws.save()
    expect(edited).toEqual({ mode: "update", proposalId: "existing-1" })

    ws.newProposal()
    const fresh = ws.save()

    expect(fresh.mode).toBe("create")
    expect(fresh.proposalId).not.toBe("existing-1")
  })

  it("the workspace key tracks every session boundary the builder must remount on", () => {
    const ws = simulateWorkspace()
    const keys: string[] = []
    ws.newProposal()
    keys.push(ws.key())
    ws.save()
    ws.newProposal()
    keys.push(ws.key())
    ws.openSavedProposal("p-42")
    keys.push(ws.key())

    expect(new Set(keys).size).toBe(keys.length)
  })
})
