import { put, list, get, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { json, guard, FROM, parseAddr, threadKey, isEmail, stamp } from './_mail.js';

async function readJson(pathname) {
  const r = await get(pathname, { access: 'private', useCache: false });
  if (r?.statusCode !== 200) return null;
  return JSON.parse(await new Response(r.stream).text());
}

const save = msg => put(msg.pathname, JSON.stringify(msg), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
const validPath = p => /^mail\/[\w-]+\.json$/.test(String(p || ''));
const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// List every message
export async function GET(request) {
  const denied = guard(request);
  if (denied) return denied;
  const blobs = [];
  let cursor;
  do {
    const page = await list({ prefix: 'mail/', cursor, limit: 1000 });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const items = (await Promise.all(blobs.map(b => readJson(b.pathname).catch(() => null)))).filter(Boolean);
  items.sort((a, b) => (a.date < b.date ? 1 : -1));
  return json({ items, canSend: !!process.env.SENDGRID_API_KEY });
}

// Send a new message or a reply
export async function POST(request) {
  const denied = guard(request);
  if (denied) return denied;
  if (!process.env.SENDGRID_API_KEY) return json({ error: 'SENDGRID_API_KEY is not set in Vercel yet, so mail cannot be sent.' }, 503);

  let b;
  try { b = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const to = String(b.to || '').split(/[,;]/).map(s => parseAddr(s).email).filter(Boolean);
  if (!to.length || !to.every(isEmail)) return json({ error: 'Add a valid recipient email address.' }, 400);
  const subject = String(b.subject || '').trim().slice(0, 300) || '(no subject)';
  const body = String(b.text || '').slice(0, 50000);
  if (!body.trim()) return json({ error: 'Write a message first.' }, 400);

  let parent = null;
  if (b.replyTo && validPath(b.replyTo)) parent = await readJson(b.replyTo).catch(() => null);

  let text = body, html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(body)}</div>`;
  if (parent) {
    const who = parent.folder === 'sent' ? FROM.email : (parent.fromName ? `${parent.fromName} <${parent.from}>` : parent.from);
    const when = new Date(parent.date).toUTCString();
    const orig = parent.text || String(parent.html || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n');
    text += `\n\nOn ${when}, ${who} wrote:\n` + orig.split('\n').map(l => '> ' + l).join('\n');
    html += `<br><div style="color:#5f6368;font-family:Arial,sans-serif;font-size:13px">On ${esc(when)}, ${esc(who)} wrote:</div><blockquote style="margin:6px 0 0 6px;border-left:1px solid #ccc;padding-left:10px;color:#5f6368">${parent.html || `<div style="white-space:pre-wrap">${esc(orig)}</div>`}</blockquote>`;
  }

  const payload = {
    personalizations: [{ to: to.map(email => ({ email })) }],
    from: FROM, reply_to: FROM, subject,
    content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
  };
  if (parent?.messageId) {
    payload.headers = { 'In-Reply-To': parent.messageId, References: `${parent.references || ''} ${parent.messageId}`.trim().slice(0, 900) };
  }

  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (r.status !== 202) {
    const detail = await r.text().catch(() => '');
    console.error('sendgrid', r.status, detail);
    let msg = 'SendGrid did not accept the message.';
    try { msg = JSON.parse(detail).errors.map(e => e.message).join(' ') || msg; } catch {}
    return json({ error: msg }, 502);
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  const msg = {
    id, pathname: `mail/${stamp(now)}-${id}.json`, folder: 'sent', date: now,
    from: FROM.email, fromName: FROM.name, to: to.join(', '), cc: '',
    subject, text: body, html: '',
    sgMessageId: r.headers.get('x-message-id') || '',
    inReplyTo: parent?.messageId || '', references: payload.headers?.References || '',
    read: true, starred: false, attachments: [],
    thread: parent ? parent.thread : threadKey(to[0], subject),
  };
  await save(msg);
  return json({ ok: true, item: msg });
}

// Update flags: read, starred, folder (inbox, sent, trash)
export async function PATCH(request) {
  const denied = guard(request);
  if (denied) return denied;
  let b;
  try { b = await request.json(); } catch { return json({ error: 'Bad request.' }, 400); }
  const paths = (Array.isArray(b.pathnames) ? b.pathnames : [b.pathname]).filter(validPath);
  if (!paths.length) return json({ error: 'Nothing to update.' }, 400);
  const out = [];
  for (const p of paths) {
    const msg = await readJson(p).catch(() => null);
    if (!msg) continue;
    if (typeof b.read === 'boolean') msg.read = b.read;
    if (typeof b.starred === 'boolean') msg.starred = b.starred;
    if (b.trash === true) { msg.trashedFrom = msg.folder === 'trash' ? msg.trashedFrom : msg.folder; msg.folder = 'trash'; }
    if (b.trash === false && msg.folder === 'trash') { msg.folder = msg.trashedFrom || 'inbox'; delete msg.trashedFrom; }
    await save(msg);
    out.push(msg);
  }
  return json({ ok: true, items: out });
}

// Delete forever (message and its attachments)
export async function DELETE(request) {
  const denied = guard(request);
  if (denied) return denied;
  let b = {};
  try { b = await request.json(); } catch {}
  const paths = (Array.isArray(b.pathnames) ? b.pathnames : []).filter(validPath);
  for (const p of paths) {
    const msg = await readJson(p).catch(() => null);
    const extra = (msg?.attachments || []).map(a => a.pathname).filter(x => /^mail-att\//.test(x));
    await del([p, ...extra]);
  }
  return json({ ok: true });
}
