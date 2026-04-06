/**
 * Maps a WorkOS AuthKit user to SpacetimeDB credentials and HTTP-only STDB cookies.
 * Called from AuthKit callback `onSuccess` after WorkOS session is saved.
 */
import 'server-only'

import {
  callStdbReducer,
  decryptToken,
  encryptToken,
  findCredentialByEmailCaseInsensitive,
  findCredentialByWorkosUserId,
  provisionStdbIdentity,
} from '@/lib/stdb-auth-server'
import { saveStdbSession } from '@/app/actions/save-stdb-token'
import { workOsEmailVerified, workOsPrimaryEmail, type WorkOsAuthKitUser } from '@/lib/workos-user-fields'

/**
 * Provisions or loads STDB identity and sets `stdb_token` / `stdb_identity` cookies.
 */
export async function bridgeWorkOsUserToStdbSession(user: WorkOsAuthKitUser): Promise<void> {
  const email = workOsPrimaryEmail(user)
  const workosUserId = user.id?.trim()
  if (!email || !workosUserId) {
    throw new Error('WorkOS user is missing email or id')
  }

  const byWorkos = await findCredentialByWorkosUserId(workosUserId)
  if (byWorkos) {
    const token = await decryptToken(byWorkos.stdb_token_enc)
    await saveStdbSession(token, byWorkos.identity)
    return
  }

  const byEmail = await findCredentialByEmailCaseInsensitive(email)
  if (byEmail) {
    const existingWorkos = byEmail.workos_user_id?.trim()
    if (existingWorkos && existingWorkos !== workosUserId) {
      throw new Error('This email is already linked to a different SSO identity')
    }
    if (!existingWorkos) {
      await callStdbReducer('link_workos_user', [byEmail.identity, workosUserId])
    }
    const token = await decryptToken(byEmail.stdb_token_enc)
    await saveStdbSession(token, byEmail.identity)
    return
  }

  const { identity, token } = await provisionStdbIdentity()
  const tokenEnc = await encryptToken(token)
  const canonicalEmail = email.toLowerCase()
  await callStdbReducer('store_sso_user_credential', [
    identity,
    canonicalEmail,
    tokenEnc,
    workosUserId,
    workOsEmailVerified(user),
  ])
  await saveStdbSession(token, identity)
}
