import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { json, parseAddr, threadKey, stamp } from './_mail.js';

// Receives email from SendGrid Inbound Parse (multipart form, not raw)
export async function POST(request) {
  let fd;
  try { fd = await request.formData(); } catch { return json({ error: 'Expected form data.' }, 400); }
  const field = k => { const v = fd.get(k); return typeof v === 'string' ? v : ''; };

  const headers = field('headers');
  const envelope = field('envelope');
  // Only keep mail actually addressed to this domain
  if (!headers || !/vibeo\.ink/i.test(field('to') + envelope)) return json({ ok: true });

  const hdr = name => {
    const m = headers.match(new RegExp('^' + name + ':[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)', 'im'));
    return m ? m[1].replace(/\r?\n[ \t]+/g, ' ').trim() : '';
  };

  const id = randomUUID();
  const now = new Date().toISOString();
  const from = parseAddr(field('from'));

  let info = {};
  try { info = JSON.parse(field('attachment-info') || '{}'); } catch {}
  const attachments = [];
  for (const [key, value] of fd.entries()) {
    if (typeof value === 'string' || !value || !value.size) continue;
    const meta = info[key] || {};
    const name = String(meta.filename || value.name || key).replace(/[^\w.\- ()]/g, '_').slice(0, 120) || key;
    const pathname = `mail-att/${id}/${attachments.length}-${name}`;
    try {
      await put(pathname, value, { access: 'private', contentType: meta.type || value.type || 'application/octet-stream', addRandomSuffix: false });
      attachments.push({ name, type: meta.type || value.type || '', size: value.size, pathname });
    } catch (e) { console.error('attachment save failed', e); }
  }

  const dateHdr = Date.parse(hdr('Date'));
  const subject = field('subject') || '(no subject)';
  const pathname = `mail/${stamp(now)}-${id}.json`;
  const msg = {
    id, pathname, folder: 'inbox',
    date: Number.isFinite(dateHdr) ? new Date(dateHdr).toISOString() : now,
    receivedAt: now,
    from: from.email, fromName: from.name,
    to: field('to'), cc: field('cc'),
    subject, text: field('text'), html: field('html'),
    messageId: hdr('Message-ID'), inReplyTo: hdr('In-Reply-To'), references: hdr('References'),
    spamScore: field('spam_score'),
    read: false, starred: false, attachments,
    thread: threadKey(from.email, subject),
  };

  await put(pathname, JSON.stringify(msg), { access: 'private', contentType: 'application/json', addRandomSuffix: false });
  return json({ ok: true });
}
