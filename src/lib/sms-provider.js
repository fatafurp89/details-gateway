// SMS provider interface — not connected yet. Implement send() when a provider is chosen.
export const smsEnabled = () => false;

export async function sendSms(/* { to, text } */) {
  return { sent: false, reason: 'not_configured' };
}
