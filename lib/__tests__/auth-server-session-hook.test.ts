import { describe, it, expect, vi, beforeEach } from "vitest"

const { userUpdateMock } = vi.hoisted(() => ({
  userUpdateMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: { user: { update: userUpdateMock } },
}))

import { _hookAfterSessionCreate } from "@/lib/auth-server"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("session.create.after — lastLoginAt", () => {
  it("stamps lastLoginAt on the signed-in user", async () => {
    userUpdateMock.mockResolvedValue({})
    const before = Date.now()

    await _hookAfterSessionCreate("user-1")

    expect(userUpdateMock).toHaveBeenCalledTimes(1)
    const arg = userUpdateMock.mock.calls[0][0] as {
      where: { id: string }
      data: { lastLoginAt: Date }
    }
    expect(arg.where).toEqual({ id: "user-1" })
    expect(arg.data.lastLoginAt).toBeInstanceOf(Date)
    expect(arg.data.lastLoginAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it("never fails the sign-in when the update throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    userUpdateMock.mockRejectedValue(new Error("db down"))

    await expect(_hookAfterSessionCreate("user-2")).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(
      "[auth-server.afterSessionCreate]",
      expect.any(Error),
      { userId: "user-2" },
    )
    errorSpy.mockRestore()
  })
})
