import { handleAuth } from '@workos-inc/authkit-nextjs'
import { bridgeWorkOsUserToStdbSession } from '@/lib/workos-stdb-bridge'
import { completeInviteAfterWorkOsAuth } from '@/lib/workos-invite-complete'

export const GET = handleAuth({
  returnPathname: '/overview',
  onSuccess: async ({ user, state }) => {
    await bridgeWorkOsUserToStdbSession(user)
    if (typeof state === 'string' && state.length > 0) {
      try {
        await completeInviteAfterWorkOsAuth(user, state)
      } catch (err) {
        console.error('[auth/callback] invite completion failed', err)
      }
    }
  },
})
