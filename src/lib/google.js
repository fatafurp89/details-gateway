// Google sign-in (OAuth 2.0 code flow + PKCE)
import { OAuth2Client } from 'google-auth-library';

export const googleConfigured = (g) => !!(g.clientId && g.clientSecret && g.redirectUri);

const client = (g) => new OAuth2Client({ clientId: g.clientId, clientSecret: g.clientSecret, redirectUri: g.redirectUri });

export async function startGoogle(g, state) {
  const c = client(g);
  const { codeVerifier, codeChallenge } = await c.generateCodeVerifierAsync();
  const url = c.generateAuthUrl({
    scope: ['openid', 'email', 'profile'], state, prompt: 'select_account',
    code_challenge: codeChallenge, code_challenge_method: 'S256',
  });
  return { url, codeVerifier };
}

// Returns the verified email (lowercase) or null
export async function finishGoogle(g, code, codeVerifier) {
  const c = client(g);
  const { tokens } = await c.getToken({ code, codeVerifier });
  if (!tokens.id_token) return null;
  const ticket = await c.verifyIdToken({ idToken: tokens.id_token, audience: g.clientId });
  const p = ticket.getPayload();
  if (!p?.email || p.email_verified !== true) return null;
  return p.email.toLowerCase();
}
