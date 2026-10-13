import {
  toWorkflowError,
  type WorkflowOutcome,
  type ObservedTransition,
} from "@lumiere/erp-workflows"

/**
 * Run a command once and, only when its response is ambiguous, use the
 * transition's canonical readback to determine whether the intended effect
 * already committed. This never retries the write. Permission, validation,
 * stale-state, and other definitive rejections are preserved unchanged.
 *
 * Approval-pending is deliberately not treated as recovery: an unchanged
 * record alone cannot prove that an approval task was created.
 */
export async function executeCommandWithAppliedRecovery(
  command: () => Promise<void>,
  observe: () => Promise<ObservedTransition>,
  recoverOutcomes: readonly WorkflowOutcome[] = ["applied"],
): Promise<void> {
  try {
    await command()
  } catch (error) {
    if (!toWorkflowError(error).needsReadback) throw error

    try {
      const observed = await observe()
      if (observed.outcome != null && recoverOutcomes.includes(observed.outcome)) return
    } catch {
      // Preserve the command failure. The caller's normal completion path
      // will refresh affected resources and report the unresolved outcome.
    }

    throw error
  }
}
