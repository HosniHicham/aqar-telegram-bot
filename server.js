'use strict';
// =========================================================================
// 🌐 API — يربط واجهة الويب (aqar-algeria.html) بنفس بيانات البوت (Supabase)
// الاستخدام في index.js:  require('./api')(core);
// متغيرات بيئة اختيارية:
//   API_ADMIN_KEY        مفتاح سري لدخول الإدارة من المتصفح (بدون تيليغرام)
//   API_ALLOWED_ORIGINS  نطاقات CORS مفصولة بفاصلة (غير مطلوبة إذا خدمت الصفحة من /app)
// =========================================================================
const crypto = require('crypto');
const path = require('path');

module.exports = function registerApi(core) {
  const {
    app, bot, supabase, getAdminIds, getUserRecord, sanitizeNumericPrice,
    escapeHtml, formatDateTime, fitTelegramText, parseMediaListFromField, MAX_PROPERTY_IMAGES
  } = core;

  const BOT_TOKEN = process.env.BOT_TOKEN;
  const ADMIN_KEY = process.env.API_ADMIN_KEY || '';
  const ALLOWED = (process.env.API_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

  const ROLE = { 'مراجعة الإعلانات': 'ads_reviewer', 'الدفع': 'payments_admin', 'النقاط': 'points_admin', 'الدعم العام': 'general_support' };
  const ROLE_REV = Object.fromEntries(Object.entries(ROLE).map(([k, v]) => [v, k]));
  const INQ_STATUS = { open: 'open', in_progress: 'progress', resolved: 'solved', closed: 'closed' };

  app.set('trust proxy', 1);

  // ---------- CORS ----------
  app.use('/api', (req, res, next) => {
    const o = req.headers.origin;
    if (o && (ALLOWED.includes('*') || ALLOWED.includes(o))) {
      res.setHeader('Access-Control-Allow-Origin', o);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-telegram-init-data,x-admin-key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ---------- Rate limit للكتابة ----------
  const hits = new Map();
  function limit(req, res, next) {
    const now = Date.now();
    const arr = (hits.get(req.ip) || []).filter(t => now - t < 60000);
    if (arr.length >= 15) return res.status(429).json({ error: 'محاولات كثيرة، أعد المحاولة بعد دقيقة' });
    arr.push(now); hits.set(req.ip, arr); next();
  }

  // ---------- التحقق من هوية تيليغرام (initData) ----------
  function safeEq(a, b) {
    const x = Buffer.from(String(a)), y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
  function verifyInitData(raw) {
    try {
      if (!raw || !BOT_TOKEN) return null;
      const p = new URLSearchParams(raw);
      const hash = p.get('hash');
      if (!hash) return null;
      p.delete('hash');
      const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
      const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
      const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
      if (!safeEq(calc, hash)) return null;
      if (Date.now() / 1000 - Number(p.get('auth_date') || 0) > 86400) return null;
      const id = Number(JSON.parse(p.get('user') || '{}').id);
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    } catch (e) { return null; }
  }
  async function auth(req, res, next) {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    req.tgId = verifyInitData(req.headers['x-telegram-init-data']) || verifyToken(bearer);
    const key = req.headers['x-admin-key'];
    const byKey = !!(ADMIN_KEY && key && safeEq(key, ADMIN_KEY));
    const ids = await getAdminIds();
    req.isAdmin = byKey || (!!req.tgId && ids.includes(req.tgId));
    req.adminActor = req.tgId && ids.includes(req.tgId) ? req.tgId : (ids[0] || 0);
    next();
  }
  const needAdmin = (req, res, next) => req.isAdmin ? next() : res.status(403).json({ error: 'للإدارة فقط' });
  const needUser = async (req, res, next) => {
    if (!req.tgId) return res.status(401).json({ error: 'سجّل الدخول: أرسل /web للبوت ثم أدخل الرمز في الصفحة' });
    if (!(await getUserRecord(req.tgId))) return res.status(403).json({ error: 'فعّل حسابك في البوت أولاً (مشاركة رقم الهاتف)' });
    next();
  };

  // ---------- أدوات ----------
  const isHttp = s => /^https?:\/\/\S+$/i.test(String(s || '').trim());
  const mediaUrl = ref => isHttp(ref) ? ref : '/api/media/' + encodeURIComponent(ref);
  const photos = field => parseMediaListFromField(field).slice(0, MAX_PROPERTY_IMAGES).map(mediaUrl);

  function mapAd(r, status, admin) {
    return {
      id: r.id,
      type: r.property_type || '',
      wilaya: r.state_name || '',
      commune: '',
      price: sanitizeNumericPrice(r.price),
      desc: r.description || r.message || '',
      feats: [],
      phone: r.phone || '',
      date: formatDateTime(r.created_at),
      status,
      pkg: status === 'published' ? 'public' : (r.receipt_url === 'FREE_NO_RECEIPT' ? 'free' : 'paid'),
      user: admin ? String(r.user_id || '') : undefined,
      imgs: photos(r.image_url)
    };
  }
  function mapInquiry(q, replies, admin) {
    const att = (q.attachment_url || '').replace(/^tg:/, '');
    return {
      id: q.id,
      status: INQ_STATUS[q.status] || 'open',
      pid: q.property_id || null,
      cat: ROLE_REV[q.target_role] || 'الدعم العام',
      subj: q.subject || '',
      msg: q.message || '',
      date: formatDateTime(q.created_at),
      att: att && att !== 'EMPTY' ? mediaUrl(att) : '',
      user: admin ? String(q.user_id) : undefined,
      replies: replies.map(r => `${r.reply_message || (r.media_type === 'photo' ? '🖼 صورة مرفقة' : r.media_type === 'video' ? '🎥 فيديو مرفق' : '')} — الإدارة`)
    };
  }
  async function notifyAdmins(text) {
    for (const id of await getAdminIds()) {
      bot.telegram.sendMessage(id, text, { parse_mode: 'HTML' }).catch(() => {});
    }
  }

  // ---------- وسائط تيليغرام عبر البروكسي (بدون كشف توكن البوت) ----------
  app.get('/api/media/:id', async (req, res) => {
    const id = req.params.id;
    if (!/^[A-Za-z0-9_-]{20,250}$/.test(id)) return res.sendStatus(400);
    try {
      const link = await bot.telegram.getFileLink(id);
      const r = await fetch(String(link));
      if (!r.ok) return res.sendStatus(404);
      const p = String(link).toLowerCase();
      const type = p.endsWith('.mp4') ? 'video/mp4' : p.endsWith('.png') ? 'image/png' : p.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.sendStatus(404); }
  });

  // ---------- GET /api/dashboard ----------
  app.get('/api/dashboard', auth, async (req, res) => {
    try {
      const admin = req.isAdmin;
      const pubQ = supabase.from('test_messages').select('*').order('id', { ascending: false }).limit(100);
      const penQ = admin
        ? supabase.from('pending_properties').select('*').order('id', { ascending: false }).limit(100)
        : Promise.resolve({ data: [] });
      let inqQ = Promise.resolve({ data: [] });
      if (admin) inqQ = supabase.from('user_inquiries').select('*').order('id', { ascending: false }).limit(100);
      else if (req.tgId) inqQ = supabase.from('user_inquiries').select('*').eq('user_id', req.tgId).order('id', { ascending: false }).limit(100);

      const [pub, pen, inq] = await Promise.all([pubQ, penQ, inqQ]);
      const inqs = inq.data || [];
      let reps = [];
      if (inqs.length) {
        const { data } = await supabase.from('inquiry_replies').select('*').in('inquiry_id', inqs.map(i => i.id)).order('id', { ascending: true });
        reps = data || [];
      }
      const ads = [
        ...(pub.data || []).map(r => mapAd(r, 'published', admin)),
        ...(pen.data || []).map(r => mapAd(r, r.status === 'rejected' ? 'rejected' : r.status === 'approved' ? null : 'pending', true)).filter(a => a && a.status)
      ].filter(a => a.status);
      res.json({
        isAdmin: admin,
        ads,
        inquiries: inqs.map(q => mapInquiry(q, reps.filter(r => r.inquiry_id === q.id), admin))
      });
    } catch (e) {
      console.error('dashboard error:', e);
      res.status(500).json({ error: 'تعذّر تحميل البيانات' });
    }
  });

  // ---------- POST /api/ads ----------
  app.post('/api/ads', limit, auth, needUser, async (req, res) => {
    try {
      const b = req.body || {};
      const type = String(b.type || '').trim().slice(0, 40);
      const wilaya = String(b.wilaya || '').trim().slice(0, 40);
      const price = Number(String(b.price).replace(/\D/g, ''));
      const phone = String(b.phone || '').replace(/[\s.-]/g, '');
      const commune = String(b.commune || '').trim().slice(0, 60);
      const desc = String(b.desc || '').trim().slice(0, 1500);
      const imgs = (Array.isArray(b.imgs) ? b.imgs : []).filter(isHttp).slice(0, MAX_PROPERTY_IMAGES);
      if (!type || !wilaya) return res.status(400).json({ error: 'النوع والولاية مطلوبان' });
      if (!Number.isFinite(price) || price <= 0 || price > 1e11) return res.status(400).json({ error: 'سعر غير صالح' });
      if (!/^0[567]\d{8}$/.test(phone)) return res.status(400).json({ error: 'رقم هاتف غير صالح' });
      if (b.pkg === 'points') return res.status(400).json({ error: 'النشر بالنقاط متاح عبر البوت فقط حالياً' });

      let receipt = 'FREE_NO_RECEIPT';
      if (b.pkg === 'paid') {
        receipt = String(b.receipt || '').trim().slice(0, 500);
        if (!receipt) return res.status(400).json({ error: 'أرفق رابط الوصل أو ملاحظة الدفع' });
      }
      const description = (commune ? `📍 ${commune}\n` : '') + (desc || 'عقار جديد');
      const { data, error } = await supabase.from('pending_properties').insert([{
        user_id: req.tgId, property_type: type, state_name: wilaya, price, phone,
        description, image_url: imgs.length ? imgs.join('|') : 'EMPTY', video_url: 'EMPTY',
        receipt_url: receipt, status: 'pending'
      }]).select('id').single();
      if (error) throw error;
      notifyAdmins(`🆕 <b>إعلان جديد من الموقع</b> <code>#${data.id}</code>\n🏠 ${escapeHtml(type)} — 📍 ${escapeHtml(wilaya)}\n👤 <code>${req.tgId}</code>`);
      res.json({ id: data.id });
    } catch (e) {
      console.error('POST /api/ads:', e);
      res.status(500).json({ error: 'تعذّر حفظ الإعلان' });
    }
  });

  // ---------- POST /api/inquiries ----------
  app.post('/api/inquiries', limit, auth, needUser, async (req, res) => {
    try {
      const b = req.body || {};
      const subject = String(b.subj || '').trim().slice(0, 100);
      const message = String(b.msg || '').trim().slice(0, 2000);
      if (!subject || !message) return res.status(400).json({ error: 'الموضوع والرسالة مطلوبان' });
      const pid = Number(b.pid);
      const att = isHttp(b.att) ? String(b.att).trim() : null;
      const { data, error } = await supabase.from('user_inquiries').insert([{
        user_id: req.tgId,
        property_id: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
        target_role: ROLE[b.cat] || 'general_support',
        subject, message, attachment_url: att, status: 'open'
      }]).select('id').single();
      if (error) throw error;
      notifyAdmins(`📩 <b>استعلام جديد من الموقع</b> <code>#${data.id}</code>\n📌 ${escapeHtml(subject)}`);
      res.json({ id: data.id });
    } catch (e) {
      console.error('POST /api/inquiries:', e);
      res.status(500).json({ error: 'تعذّر حفظ الاستعلام' });
    }
  });

  // ---------- POST /api/admin/ads/:id/action ----------
  app.post('/api/admin/ads/:id/action', limit, auth, needAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const action = req.body && req.body.action;
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'معرّف غير صالح' });
    try {
      if (action === 'delete') {
        await supabase.from('test_messages').delete().eq('id', id);
        return res.json({ ok: true });
      }
      const { data: item, error } = await supabase.from('pending_properties').select('*').eq('id', id).single();
      if (error || !item) return res.status(404).json({ error: 'الطلب غير متوفر' });
      if (item.status === 'approved') return res.status(409).json({ error: 'تم نشر الإعلان مسبقاً' });
      const isFree = item.receipt_url === 'FREE_NO_RECEIPT';

      if (action === 'requeue') {
        await supabase.from('pending_properties').update({ status: 'pending' }).eq('id', id);
        return res.json({ ok: true });
      }
      if (action === 'approve') {
        const nowIso = new Date().toISOString();
        const row = {
          user_id: item.user_id, property_type: item.property_type, state_name: item.state_name,
          price: sanitizeNumericPrice(item.price), phone: String(item.phone || '').replace(/\D/g, ''),
          description: item.description, message: item.description,
          image_url: item.image_url || 'EMPTY', video_url: item.video_url || 'EMPTY'
        };
        let { error: e1 } = await supabase.from('test_messages').insert([{ ...row, created_at: nowIso }]);
        if (e1) ({ error: e1 } = await supabase.from('test_messages').insert([row]));
        if (e1) throw e1;
        await supabase.from('pending_properties').update({ status: 'approved' }).eq('id', id);
        bot.telegram.sendMessage(item.user_id,
          `🎉 <b>تمت الموافقة على إعلانك (#${id}) ونشره في المنصة.</b>\n🕒 <code>${escapeHtml(formatDateTime(nowIso))}</code>`,
          { parse_mode: 'HTML' }).catch(() => {});
        return res.json({ ok: true });
      }
      if (action === 'reject') {
        await supabase.from('pending_properties').update({ status: 'rejected' }).eq('id', id);
        bot.telegram.sendMessage(item.user_id,
          isFree ? `❌ <b>نعتذر، لم تتم الموافقة على نشر إعلانك المجاني (#${id}).</b>`
                 : `❌ <b>نعتذر، تعذّر قبول وصل الدفع الخاص بإعلانك (#${id}).</b>`,
          { parse_mode: 'HTML' }).catch(() => {});
        return res.json({ ok: true });
      }
      res.status(400).json({ error: 'إجراء غير معروف' });
    } catch (e) {
      console.error('admin action:', e);
      res.status(500).json({ error: 'تعذّرت العملية' });
    }
  });

  // ---------- POST /api/admin/inquiries/:id/reply ----------
  app.post('/api/admin/inquiries/:id/reply', limit, auth, needAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const message = String((req.body && req.body.message) || '').trim().slice(0, 2000);
      if (!Number.isSafeInteger(id) || id <= 0 || !message) return res.status(400).json({ error: 'بيانات غير صالحة' });
      const { data: inq, error } = await supabase.from('user_inquiries').select('*').eq('id', id).single();
      if (error || !inq) return res.status(404).json({ error: 'الاستعلام غير موجود' });
      const { error: e2 } = await supabase.from('inquiry_replies').insert([{
        inquiry_id: id, admin_id: req.adminActor, admin_role: inq.target_role || 'general_support',
        reply_message: message, media_type: 'text', attachment_url: null
      }]);
      if (e2) throw e2;
      if (inq.status === 'open') await supabase.from('user_inquiries').update({ status: 'in_progress' }).eq('id', id);
      const prop = inq.property_id ? `🏠 <b>بخصوص الإعلان:</b> <code>#${inq.property_id}</code>\n` : '';
      bot.telegram.sendMessage(inq.user_id,
        fitTelegramText(`📩 <b>رد من إدارة عقار الجزائر على استعلامك #${id}</b>\n${prop}━━━━━━━━━━━━━━━━━━━━\n${escapeHtml(message)}`),
        { parse_mode: 'HTML' }).catch(() => {});
      res.json({ ok: true });
    } catch (e) {
      console.error('admin reply:', e);
      res.status(500).json({ error: 'تعذّر حفظ الرد' });
    }
  });

  // ---------- 🔑 دخول الموقع بحساب تيليغرام (رمز من البوت) ----------
  const SECRET = crypto.createHash('sha256').update('aqar-session:' + BOT_TOKEN).digest();
  const sign = p => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  function signToken(id) {
    const p = `${id}.${Date.now() + 30 * 864e5}`;
    return `${p}.${sign(p)}`;
  }
  function verifyToken(t) {
    const m = /^(\d+)\.(\d+)\.([\w-]+)$/.exec(t || '');
    if (!m || Date.now() > Number(m[2]) || !safeEq(sign(`${m[1]}.${m[2]}`), m[3])) return null;
    return Number(m[1]);
  }
  const loginCodes = new Map(); // code -> { id, exp }
  setInterval(() => { const n = Date.now(); for (const [c, v] of loginCodes) if (v.exp < n) loginCodes.delete(c); }, 60000).unref();

  // يعمل قبل بقية ميدلوير البوت (يتطلب أن يكون require('./api') قبل أول bot.use)
  bot.use(async (ctx, next) => {
    const t = ctx.message && ctx.message.text && ctx.message.text.trim();
    if (!t || !/^\/(web|login)(@\w+)?$/i.test(t) || !ctx.from) return next();
    const id = ctx.from.id;
    if (!(await getUserRecord(id)) && !(await core.isAdmin(id))) {
      return ctx.reply('⚠️ فعّل حسابك أولاً بمشاركة رقم هاتفك عبر /start.');
    }
    for (const [c, v] of loginCodes) if (v.id === id) loginCodes.delete(c);
    const code = String(crypto.randomInt(100000, 1000000));
    loginCodes.set(code, { id, exp: Date.now() + 5 * 60000 });
    await ctx.reply(
      `🔑 <b>رمز دخول الموقع:</b> <code>${code}</code>\n⏱ صالح 5 دقائق ويُستعمل مرة واحدة.\nأدخله في خانة الربط بالصفحة.`,
      { parse_mode: 'HTML' }
    );
  });

  app.post('/api/auth/code', limit, async (req, res) => {
    const code = String((req.body && req.body.code) || '').trim();
    const v = loginCodes.get(code);
    if (!v || v.exp < Date.now()) return res.status(400).json({ error: 'رمز غير صحيح أو منتهي' });
    loginCodes.delete(code);
    const ids = await getAdminIds();
    res.json({ token: signToken(v.id), id: v.id, isAdmin: ids.includes(v.id) });
  });

  // ---------- متابعة المستخدم داخل استعلامه (من الموقع) ----------
  app.post('/api/inquiries/:id/followup', limit, auth, needUser, async (req, res) => {
    try {
      const id = Number(req.params.id);
      const text = String((req.body && req.body.message) || '').trim().slice(0, 800);
      if (!Number.isSafeInteger(id) || id <= 0 || !text) return res.status(400).json({ error: 'بيانات غير صالحة' });
      const { data: inq, error } = await supabase.from('user_inquiries').select('*').eq('id', id).single();
      if (error || !inq || Number(inq.user_id) !== req.tgId) return res.status(404).json({ error: 'الاستعلام غير موجود' });
      const merged = `${inq.message || ''}\n\n↩️ متابعة (${formatDateTime()}): ${text}`.slice(-4000);
      const { error: e2 } = await supabase.from('user_inquiries').update({ message: merged, status: 'open' }).eq('id', id);
      if (e2) throw e2;
      notifyAdmins(`↩️ <b>متابعة جديدة على الاستعلام</b> <code>#${id}</code>\n${escapeHtml(text)}`);
      res.json({ ok: true });
    } catch (e) {
      console.error('followup:', e);
      res.status(500).json({ error: 'تعذّر إرسال المتابعة' });
    }
  });

  // ---------- تقديم الواجهة من نفس السيرفر: https://DOMAIN/app ----------
  app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'aqar-algeria.html')));
};
