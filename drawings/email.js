// Quotation request email in the style already used with the supplier.
import { displayName, fileBase, wantsFullSet } from './model.js';

export function todayDDMMYYYY(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function emailSubject(date = new Date()) {
  return `Quotation – ${todayDDMMYYYY(date)}`;
}

export function partLine(p) {
  const bits = [displayName(p)];
  bits.push(p.quantity ? `${p.quantity} units` : '___ units');
  if (p.material) bits.push(p.material);
  if (p.finish) bits.push(p.finish);
  return `   - ${bits.join(' – ')}`;
}

export function emailBody(parts, { supplierName = 'Mandy', signature = 'Dudu Galili' } = {}) {
  const lines = [];
  lines.push(`Dear ${supplierName},`, '', 'How are you?', '');
  lines.push(parts.length === 1 ? 'Please send a quotation for the attached drawing:' : 'Please send a quotation for the attached drawings:');
  parts.forEach((p) => lines.push(partLine(p)));
  const noted = parts.filter((p) => p.notes.length);
  if (noted.length) {
    lines.push('', 'Please note:');
    noted.forEach((p) => p.notes.forEach((n) => lines.push(`   - ${displayName(p)}: ${n}`)));
  }
  lines.push('', 'All dimensions, materials and quantities are as shown on the drawings.', '', 'Best regards,', signature);
  return lines.join('\n');
}

export function attachmentList(parts) {
  const files = [];
  parts.forEach((p) => {
    const b = fileBase(p);
    files.push(`${b}.pdf`);
    if (wantsFullSet(p)) files.push(`${b}.step`, `${b}.dxf`);
  });
  return files;
}

export function gmailComposeUrl(to, subject, body) {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
  return `https://mail.google.com/mail/?${q.toString()}`;
}
