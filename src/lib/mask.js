// Masking for display on the login screen (pure)
const DOT = '•';

export function normalizeMobile(m) {
  let d = String(m ?? '').replace(/[^\d+]/g, '');
  if (d.startsWith('+966')) d = '0' + d.slice(4);
  else if (d.startsWith('00966')) d = '0' + d.slice(5);
  else if (d.startsWith('966') && d.length === 12) d = '0' + d.slice(3);
  return d.replace(/\D/g, '');
}

// 0551234567 -> 0551•••••67 (fixed width so the length is not revealed)
export function maskMobile(m) {
  const d = normalizeMobile(m);
  if (d.length < 7) return '';
  return d.slice(0, 4) + DOT.repeat(5) + d.slice(-2);
}

// mohammed@details-consults.sa -> m•••@details-consults.sa
export function maskEmail(e) {
  const s = String(e ?? '').trim();
  const at = s.lastIndexOf('@');
  if (at < 1) return '';
  return s[0] + DOT.repeat(3) + s.slice(at);
}
