import { describe, it, expect } from "vitest"
import { selectScopeableCategories } from "@/lib/contracts/scopeable-categories"

const all = [
  { id: "ext", name: "Ortho-Extremity" },
  { id: "sports", name: "Ortho-Sports Med" },
  { id: "joints", name: "Ortho-Joints" },
  { id: "joints2", name: "Joints-Ortho" }, // canonical dupe of Ortho-Joints
  { id: "joints3", name: "Ortho Joints" }, // canonical dupe
  { id: "instr", name: "Instruments-Ortho" },
  { id: "junk1", name: "0" }, // import junk, no COG spend
  { id: "junk2", name: "EA" },
  { id: "spine", name: "Ortho-Spine" }, // real taxonomy but no COG spend here
]
const cog = ["Ortho-Sports Med", "Ortho-Joints", "Ortho-Extremity", "Instruments-Ortho"]

describe("selectScopeableCategories (bugs.rtfd 2026-06-13)", () => {
  it("offers every COG category, deduped by canonical name, no junk", () => {
    const result = selectScopeableCategories(all, cog, [])
    const names = result.map((c) => c.name).sort()
    // 4 real categories — the 3 Joints spellings collapse to one (the COG spelling)
    expect(names).toEqual([
      "Instruments-Ortho",
      "Ortho-Extremity",
      "Ortho-Joints",
      "Ortho-Sports Med",
    ])
  })

  it("prefers the exact COG spelling when several taxonomy rows collide", () => {
    const result = selectScopeableCategories(all, cog, [])
    const joints = result.find(
      (c) => c.name === "Ortho-Joints" || c.name === "Joints-Ortho" || c.name === "Ortho Joints",
    )
    expect(joints?.name).toBe("Ortho-Joints") // the COG spelling
    expect(joints?.id).toBe("joints")
  })

  it("excludes junk and non-COG categories that aren't selected", () => {
    const ids = selectScopeableCategories(all, cog, []).map((c) => c.id)
    expect(ids).not.toContain("junk1")
    expect(ids).not.toContain("junk2")
    expect(ids).not.toContain("spine")
  })

  it("always keeps an already-selected category (so it can be deselected)", () => {
    // Spine has no COG spend but was selected on the contract — must stay.
    const result = selectScopeableCategories(all, cog, ["spine"])
    expect(result.map((c) => c.id)).toContain("spine")
  })

  it("a selected dupe spelling wins its canonical slot (badge resolves)", () => {
    // Term selected the "Joints-Ortho" spelling; it must remain in the list.
    const result = selectScopeableCategories(all, cog, ["joints2"])
    const jointsRows = result.filter((c) =>
      ["joints", "joints2", "joints3"].includes(c.id),
    )
    expect(jointsRows).toHaveLength(1)
    expect(jointsRows[0]!.id).toBe("joints2")
  })

  it("empty COG universe + no selection → empty (degrades safely)", () => {
    expect(selectScopeableCategories(all, [], [])).toEqual([])
  })
})
