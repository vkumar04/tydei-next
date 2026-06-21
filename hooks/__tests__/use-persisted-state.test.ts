import { describe, it, expect } from "vitest"
import { loadPersisted, savePersisted } from "../use-persisted-state"

/** Minimal in-memory Storage stand-in (node, no DOM). */
function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    _dump: () => Object.fromEntries(m),
  }
}

describe("usePersistedState storage helpers", () => {
  it("loadPersisted returns the parsed stored value when present", () => {
    const s = fakeStorage({ k: JSON.stringify([1, 2, 3]) })
    expect(loadPersisted(s, "k", [])).toEqual([1, 2, 3])
  })

  it("loadPersisted returns the fallback when the key is missing", () => {
    expect(loadPersisted(fakeStorage(), "k", ["fallback"])).toEqual(["fallback"])
  })

  it("loadPersisted returns the fallback on corrupt JSON (never throws)", () => {
    const s = fakeStorage({ k: "{not json" })
    expect(loadPersisted(s, "k", 0)).toBe(0)
  })

  it("savePersisted writes JSON-serialized state", () => {
    const s = fakeStorage()
    savePersisted(s, "k", { a: 1 })
    expect(JSON.parse(s._dump().k)).toEqual({ a: 1 })
  })

  it("round-trips through save → load (proposals survive a reload)", () => {
    const s = fakeStorage()
    const proposals = [{ id: "p1", score: 88 }]
    savePersisted(s, "tydei:prospective:proposals:fac1", proposals)
    expect(
      loadPersisted(s, "tydei:prospective:proposals:fac1", []),
    ).toEqual(proposals)
  })

  it("savePersisted swallows storage errors", () => {
    const throwing = {
      setItem: () => {
        throw new Error("quota")
      },
    }
    expect(() => savePersisted(throwing, "k", 1)).not.toThrow()
  })
})
