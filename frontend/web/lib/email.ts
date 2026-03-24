/**
 * Server-only email utility using Resend.
 * Import ONLY from API route handlers and server actions.
 */
import 'server-only'
import { Resend } from 'resend'

const resend = new Resend(process.env['RESEND_API_KEY'])
const FROM = process.env['RESEND_FROM_EMAIL'] ?? 'noreply@lumiere-erp.com'
const APP_URL = process.env['NEXT_PUBLIC_APP_URL'] ?? 'http://localhost:3000'

export async function sendWelcomeEmail(to: string): Promise<void> {
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Welcome to Lumiere ERP',
    text: `Welcome! Your account has been created.\n\nGet started by setting up your organization at ${APP_URL}/onboarding`,
  })
}

export async function sendInviteEmail(to: string, inviterName: string, orgName: string, inviteToken: string): Promise<void> {
  const link = `${APP_URL}/accept-invite?token=${encodeURIComponent(inviteToken)}`
  await resend.emails.send({
    from: FROM,
    to,
    subject: `You've been invited to ${orgName} on Lumiere ERP`,
    text: `${inviterName} has invited you to join ${orgName} on Lumiere ERP.\n\nAccept your invitation:\n${link}\n\nThis link expires in 7 days.`,
  })
}

export async function sendPasswordResetEmail(to: string, resetToken: string): Promise<void> {
  const link = `${APP_URL}/reset-password?token=${encodeURIComponent(resetToken)}`
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Reset your Lumiere ERP password',
    text: `You requested a password reset.\n\nReset your password:\n${link}\n\nThis link expires in 1 hour. If you did not request this, ignore this email.`,
  })
}
