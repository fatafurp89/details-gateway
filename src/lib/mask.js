// Masking for display on the login screen (pure)
const DOT = '•';

/**
 * يطبّع أي جوال دولي إلى صيغة E.164 (+ ثم رمز الدولة والرقم، بلا مسافات). الافتراضي عند غياب رمز الدولة: السعودية (+966)،
 * حتى تبقى الأرقام السعودية المحلية القديمة (05XXXXXXXX) صالحة، مع دعم كامل لأي دولة أخرى (موظفون عن بُعد).
 */
export function normalizeMobile(m) {
  let d = String(m ?? '').trim().replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) return '+' + d.slice(1).replace(/\D/g, '');
  if (d.startsWith('00')) return '+' + d.slice(2).replace(/\D/g, '');
  d = d.replace(/\D/g, '');
  if (/^05\d{8}$/.test(d)) return '+966' + d.slice(1);        // محلي سعودي قديم
  if (/^9665\d{8}$/.test(d)) return '+' + d;                  // سعودي بلا +
  if (/^[1-9]\d{7,14}$/.test(d)) return '+' + d;              // دولي بلا + (يُفترض رمز الدولة موجود بالفعل)
  return null;
}

// +966551234567 -> +9665•••••67 (طول ثابت حتى لا يُكشف طول الرقم)
export function maskMobile(m) {
  const d = normalizeMobile(m);
  if (!d || d.length < 8) return '';
  return d.slice(0, 5) + DOT.repeat(5) + d.slice(-2);
}

// mohammed@details-consults.sa -> m•••@details-consults.sa
export function maskEmail(e) {
  const s = String(e ?? '').trim();
  const at = s.lastIndexOf('@');
  if (at < 1) return '';
  return s[0] + DOT.repeat(3) + s.slice(at);
}
