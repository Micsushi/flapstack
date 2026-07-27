export async function cleanupRuntimeProfileProof(call, state) {
  const errors = []
  const attempt = async (operation, name, input, accepted = () => true) => {
    try {
      const result = await call(name, input)
      if (!accepted(result)) {
        errors.push({ operation, message: "cleanup operation did not confirm success" })
        return false
      }
      return true
    } catch (error) {
      errors.push({
        operation,
        message: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  const fixtureHandle = state.chat?.stage4FixtureHandle
  if (fixtureHandle && state.continuation && !state.continuationUndone) {
    const undone = await attempt(
      "undo-continuation",
      "mutate_stage4_runtime",
      {
        action: "undo-continuation",
        payload: {
          fixtureHandle,
          continuationHandle: state.continuation.continuationHandle,
        },
      },
      (result) => result?.undone === true,
    )
    if (!undone && state.continuation.chatId) {
      await attempt("archive-continuation-chat", "archive_test_chat", {
        chatId: state.continuation.chatId,
      })
    }
  }
  if (fixtureHandle && state.standaloneLaunch?.launchHandle && !state.standaloneStopped) {
    await attempt(
      "stop-standalone",
      "mutate_stage4_profile",
      {
        action: "standalone-stop",
        payload: {
          fixtureHandle,
          launchHandle: state.standaloneLaunch.launchHandle,
          reason: "stage4-live-proof-cleanup",
        },
      },
      (result) => result?.stopped === true,
    )
  }
  if (fixtureHandle && state.activitySeeded) {
    await attempt("cleanup-activity", "mutate_stage4_runtime", {
      action: "cleanup-activity",
      payload: { fixtureHandle },
    })
  }
  const standaloneLaunches =
    Array.isArray(state.standaloneLaunches) && state.standaloneLaunches.length > 0
      ? state.standaloneLaunches
      : state.standaloneLaunch
        ? [state.standaloneLaunch]
        : []
  for (const launch of standaloneLaunches) {
    if (!launch?.chatId) continue
    await attempt("archive-standalone-chat", "archive_test_chat", {
      chatId: launch.chatId,
    })
  }
  for (const [operation, profile] of [
    ["archive-standalone-profile", state.standaloneProfile],
    ["archive-imported-profile", state.importedProfile],
  ]) {
    if (!fixtureHandle || !profile?.profileHandle) continue
    await attempt(operation, "mutate_stage4_profile", {
      action: "archive",
      payload: {
        fixtureHandle,
        profileHandle: profile.profileHandle,
      },
    })
  }
  if (fixtureHandle && state.writtenDefault) {
    await attempt("delete-runtime-default", "mutate_stage4_runtime", {
      action: "delete-default",
      payload: { fixtureHandle },
    })
  }
  if (state.chat?.chatId) {
    await attempt("archive-fixture-chat", "archive_test_chat", {
      chatId: state.chat.chatId,
    })
  }
  if (state.testProject?.created || state.testProject?.restored) {
    await attempt("archive-project", "archive_test_project", {
      projectId: state.testProject.project.id,
    })
  }
  return { errors }
}
