/** Hosted admission and memberships are operator-approved; legacy invite tokens never grant access. */
import 'server-only'
export async function completeInviteAfterWorkOsAuth(): Promise<never> {
  throw new Error('Ask your administrator to approve your organization membership')
}
