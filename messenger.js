'use strict';

function buildThreadId(propertyId, ownerId, otherUserId) {
  return `p_${Number(propertyId)}_o_${Number(ownerId)}_u_${Number(otherUserId)}`;
}

// ───────── إعدادات العرض ─────────
const LRM = '\u200E'; // الطرف الآخر: يسار
const RLM = '\u200F'; // أنا: يمين
const TIMEZONE = 'Africa/Algiers'; // غيّرها حسب بلدك
const PAGE_SIZE = 30; // عدد الرسائل في كل صفحة من السجل
const LINE = '▬▬▬▬▬▬▬▬▬▬▬▬';
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

const BTN_PREV = '◀️ السابق';
const BTN_NEXT = 'التالي ▶️';

const BTN_BACK = '⬅️ قائمة المراسلين';
const BTN_HOME = '🏠 القائمة الرئيسية';

function isBadName(name) {
  const n = String(name || '').trim();
  return !n || /^مستخدم\s*\d*$/i.test(n) || /^user\s*\d*$/i.test(n) || /^\d+$/.test(n);
}

function toSup(str) {
  return String(str).replace(/\d/g, (d) => SUP[d]);
}

function formatSmallTime(iso) {
  if (!iso) return '';
  try {
    const t = new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: TIMEZONE
    });
    return toSup(t);
  } catch (_) {
    return '';
  }
}

function dayKey(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { timeZone: TIMEZONE });
  } catch (_) {
    return '';
  }
}

function dayLabel(iso) {
  const key = dayKey(iso);
  if (key === dayKey(new Date().toISOString())) return 'اليوم';
  if (key === dayKey(new Date(Date.now() - 86400000).toISOString())) return 'أمس';
  return key;
}

function createMessengerModule(core) {
  const {
    Markup,
    supabase,
    userState,
    browsingSession,
    supportUserSession,
    replyTracked,
    safeDeleteUserMessage,
    escapeHtml,
    fitTelegramText
  } = core;

  // { mode: 'list' | 'thread', senderMap, threadId, propertyId, ownerId,
  //   receiverId, otherName, cardMessageId, page }
  // page = 0 → آخر الرسائل، 1 → الصفحة الأقدم منها، وهكذا
  const messengerSession = {};

  function getUserDisplayName(from) {
    if (!from) return 'مراسل';
    const full = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
    const name = full || from.username || '';
    return isBadName(name) ? 'مراسل' : name;
  }

  // اسم حقيقي دائماً، بدون أي ID
  async function resolveCleanSenderName(otherUserId, fallbackSenderName = '') {
    const fallback = String(fallbackSenderName || '').trim();
    if (!isBadName(fallback)) return fallback;

    try {
      const { data } = await supabase
        .from('users')
        .select('first_name, last_name, username')
        .eq('id', Number(otherUserId))
        .limit(1);

      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        const full = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
        if (!isBadName(full)) return full;
        if (!isBadName(row.username)) return String(row.username).trim();
      }
    } catch (e) {}

    return 'مراسل';
  }

  async function getUnreadCount(userId) {
    const uid = Number(userId);
    if (!uid) return 0;

    try {
      const { count, error } = await supabase
        .from('messanger')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', uid)
        .neq('sender_id', uid)
        .eq('is_read', false)
        .eq('is_closed', false);

      if (error) return 0;
      return count || 0;
    } catch (e) {
      return 0;
    }
  }

  async function getMessengerButtonLabel(userId) {
    const count = await getUnreadCount(userId);
    return count > 0 ? `💬 المراسلات (${count})` : '💬 المراسلات';
  }

  async function insertMessage({
    propertyId,
    ownerId,
    senderId,
    receiverId,
    senderName,
    messageType = 'text',
    message
  }) {
    const cleanMsg = String(message || '').trim();
    if (!cleanMsg) return null;

    const pId = Number(propertyId);
    const oId = Number(ownerId);
    const sId = Number(senderId);
    const rId = Number(receiverId);
    const otherId = sId === oId ? rId : sId;
    const threadId = buildThreadId(pId, oId, otherId);

    const { data, error } = await supabase
      .from('messanger')
      .insert([{
        thread_id: threadId,
        property_id: pId,
        owner_id: oId,
        sender_id: sId,
        receiver_id: rId,
        sender_name: String(senderName || 'مراسل').trim() || 'مراسل',
        message_type: messageType,
        message: cleanMsg,
        is_read: false,
        is_closed: false,
        created_at: new Date().toISOString(),
        read_at: null
      }])
      .select()
      .single();

    if (error) {
      console.error('messanger insert error:', error);
      return null;
    }
    return data;
  }

  async function fetchSenderThreads(userId) {
    const uid = Number(userId);

    try {
      const { data, error } = await supabase
        .from('messanger')
        .select('id, thread_id, property_id, owner_id, sender_id, receiver_id, sender_name, is_read, is_closed, created_at')
        .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
        .eq('is_closed', false)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error || !Array.isArray(data)) return [];

      const threadsMap = new Map();

      for (const row of data) {
        const otherId = Number(row.sender_id) === uid ? Number(row.receiver_id) : Number(row.sender_id);
        if (!otherId || otherId === uid) continue;

        const tId = row.thread_id || buildThreadId(row.property_id, row.owner_id, otherId);

        if (!threadsMap.has(tId)) {
          threadsMap.set(tId, {
            threadId: tId,
            propertyId: row.property_id,
            ownerId: row.owner_id,
            otherId,
            rawSenderName: '',
            unreadCount: 0
          });
        }

        const entry = threadsMap.get(tId);
        if (!entry.rawSenderName && Number(row.sender_id) === otherId && row.sender_name) {
          entry.rawSenderName = row.sender_name;
        }
        if (Number(row.receiver_id) === uid && Number(row.sender_id) !== uid && row.is_read === false) {
          entry.unreadCount += 1;
        }
      }

      const base = await Promise.all(
        [...threadsMap.values()].map(async (t) => ({
          ...t,
          cleanName: await resolveCleanSenderName(t.otherId, t.rawSenderName)
        }))
      );

      // إذا تكرر نفس الاسم في أكثر من عقار نميّزه برقم العقار (وليس ID المستخدم)
      const nameCount = {};
      base.forEach((t) => { nameCount[t.cleanName] = (nameCount[t.cleanName] || 0) + 1; });

      return base.map((t) => {
        let label = t.cleanName;
        if (nameCount[t.cleanName] > 1) label += ` • عقار ${t.propertyId}`;
        const buttonText = t.unreadCount > 0 ? `🟢 ${label} (${t.unreadCount})` : `👤 ${label}`;
        return { ...t, buttonText };
      });
    } catch (e) {
      console.error('fetchSenderThreads error:', e);
      return [];
    }
  }

  // فتح صفحة من المحادثة:
  // 1) تعليم الواردة كمقروءة  2) عدّ الكل  3) جلب الصفحة المطلوبة فقط
  async function openThreadMessages(userId, threadId, page = 0) {
    const uid = Number(userId);

    await supabase
      .from('messanger')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('thread_id', threadId)
      .eq('receiver_id', uid)
      .neq('sender_id', uid)
      .eq('is_read', false);

    const { count } = await supabase
      .from('messanger')
      .select('id', { count: 'exact', head: true })
      .eq('thread_id', threadId);

    const total = count || 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const safePage = Math.min(Math.max(0, Number(page) || 0), totalPages - 1);
    const from = safePage * PAGE_SIZE;

    const { data, error } = await supabase
      .from('messanger')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    const messages = !error && Array.isArray(data) ? data.reverse() : [];
    return { messages, total, totalPages, page: safePage };
  }

  // ───────── تصميم بطاقة المحادثة ─────────
  // الصفحة الأخيرة = أحدث الرسائل. «السابق» يرجع للأقدم، «التالي» يتقدم للأحدث.
  // اسم كل طرف يظهر مرة واحدة في بداية تسلسل رسائله.
  function formatSingleThreadCard(userId, view, meta = {}) {
    const uid = Number(userId);
    const { messages, total, totalPages, page } = view;
    const otherName = meta.otherName || 'مراسل';
    const myName = meta.myName || 'أنا';
    const propertyId = meta.propertyId || messages[0]?.property_id;

    const out = [];
    let lastSender = null;
    let lastDay = null;

    for (const m of messages) {
      const mine = Number(m.sender_id) === uid;
      const who = mine ? 'me' : 'other';
      const mark = mine ? RLM : LRM;
      const color = mine ? '🟦' : '🟩';
      const time = formatSmallTime(m.created_at);
      const tick = mine ? (m.is_read ? ' ✓✓' : ' ✓') : '';
      const stamp = time ? `  <i>${time}${tick}</i>` : '';

      const dk = dayKey(m.created_at);
      if (dk && dk !== lastDay) {
        out.push(`\n${LRM}┈┈┈ 📅 <b>${escapeHtml(dayLabel(m.created_at))}</b> ┈┈┈`);
        lastDay = dk;
        lastSender = null;
      }

      // الاسم مرة واحدة لكل تسلسل: اسمي يمين، واسم الطرف الآخر يسار
      if (lastSender !== who) {
        out.push(
          mine
            ? `${RLM}${color} <b>${escapeHtml(myName)}</b>`
            : `${LRM}${color} <b>${escapeHtml(otherName)}</b>`
        );
      }
      lastSender = who;

      const lines = String(m.message).split('\n').map(escapeHtml);
      lines[lines.length - 1] += stamp;
      const body = lines.map((l) => `${mark}${color} ${l}`).join('\n');
      out.push(`<blockquote>${body}</blockquote>`);
    }

    const currentPage = totalPages - page; // الأقدم = 1، الأحدث = الأخيرة
    const hasOlder = page < totalPages - 1;
    const hasNewer = page > 0;

    const header =
      `${LRM}💬 <b>${escapeHtml(otherName)}</b>\n` +
      (propertyId ? `${LRM}🏠 <i>عقار #${propertyId}</i>\n` : '') +
      (totalPages > 1
        ? `${LRM}📄 صفحة <b>${currentPage}</b> / <b>${totalPages}</b> • <i>${total} رسالة</i>\n`
        : `${LRM}📨 <i>${total} رسالة</i>\n`) +
      `${LINE}\n`;

    const olderLeft = Math.max(0, total - (page + 1) * PAGE_SIZE);
    const topNote = hasOlder
      ? `${LRM}◀️ <i>${olderLeft} رسالة أقدم — «السابق»</i>\n\n`
      : (total > 0 ? `${LRM}🏁 <i>بداية المحادثة</i>\n\n` : '');

    const newerLeft = page * PAGE_SIZE;
    const bottomNote = hasNewer
      ? `\n\n${LRM}▶️ <i>${newerLeft} رسالة أحدث — «التالي»</i>`
      : '';

    const bodyAll = out.length
      ? out.join('\n')
      : `<i>لا توجد رسائل بعد، اكتب رسالتك الأولى 👇</i>`;

    const footer = hasNewer
      ? `\n${LINE}\n📜 <i>أنت تتصفح السجل — اكتب رسالة للعودة لآخر الرسائل</i>`
      : `\n${LINE}\n✍️ <i>اكتب رسالتك وسترسل مباشرة</i>`;

    return fitTelegramText(header + topNote + bodyAll + bottomNote + footer, false);
  }

  // ───────── لوحات المفاتيح السفلية ─────────
  // ثابتة دائماً حتى نقدر نعدّل نفس البطاقة بدون إرسال رسالة جديدة
  function threadKeyboard() {
    return Markup.keyboard([
      [BTN_PREV, BTN_NEXT],
      [BTN_REFRESH],
      [BTN_BACK, BTN_HOME]
    ]).resize();
  }

  function inboxKeyboard(labels) {
    const rows = [];
    for (let i = 0; i < labels.length; i += 2) rows.push(labels.slice(i, i + 2));
    rows.push([BTN_HOME]);
    return Markup.keyboard(rows).resize();
  }

  // تعديل البطاقة الحالية، أو إرسال جديدة (forceNew عند تغيير لوحة المفاتيح)
  async function upsertCard(ctx, userId, text, keyboardExtra, targetMsgId, forceNew = false) {
    if (targetMsgId && ctx.chat?.id) {
      if (!forceNew) {
        try {
          await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, undefined, text, {
            parse_mode: 'HTML'
          });
          return targetMsgId;
        } catch (e) {
          const desc = String(e?.description || e?.message || '');
          if (desc.includes('message is not modified')) return targetMsgId;
        }
      }
      await ctx.telegram.deleteMessage(ctx.chat.id, targetMsgId).catch(() => {});
    }

    const sent = await replyTracked(
      ctx,
      userId,
      text,
      { parse_mode: 'HTML', ...keyboardExtra },
      true
    );
    return sent?.message_id || null;
  }

  async function showInboxList(ctx) {
    const userId = ctx.from.id;
    delete userState[userId];
    delete browsingSession[userId];
    delete supportUserSession[userId];

    const prev = messengerSession[userId] || {};
    if (prev.cardMessageId && ctx.chat?.id) {
      await ctx.telegram.deleteMessage(ctx.chat.id, prev.cardMessageId).catch(() => {});
    }

    const threads = await fetchSenderThreads(userId);

    if (!threads.length) {
      delete messengerSession[userId];
      const unreadCount = await getUnreadCount(userId);
      await replyTracked(
        ctx,
        userId,
        `📭 <b>صندوق المراسلات فارغ</b>\n${LINE}\n<i>ستظهر هنا محادثاتك مع أصحاب العقارات.</i>`,
        { parse_mode: 'HTML', ...core.getMainMenuKeyboard(userId, unreadCount) },
        true
      );
      return;
    }

    const senderMap = {};
    threads.forEach((t) => { senderMap[t.buttonText] = t; });

    const totalUnread = threads.reduce((s, t) => s + t.unreadCount, 0);
    const text =
      `👇 <i>اختر محادثة من الأزرار بالأسفل</i>`;

    const sent = await replyTracked(
      ctx,
      userId,
      text,
      { parse_mode: 'HTML', ...inboxKeyboard(Object.keys(senderMap)) },
      true
    );

    messengerSession[userId] = {
      mode: 'list',
      senderMap,
      cardMessageId: sent?.message_id || null
    };
  }

  // opts: { editMessageId, forceNew, page }
  async function renderActiveThread(ctx, userId, threadId, meta = {}, opts = {}) {
    const { editMessageId = null, forceNew = false, page = 0 } = opts;
    const view = await openThreadMessages(userId, threadId, page);
    const messages = view.messages;

    const first = messages[0] || {};
    const ownerId = Number(first.owner_id || meta.ownerId);
    const propertyId = Number(first.property_id || meta.propertyId);
    const receiverId = Number(
      meta.receiverId ||
      (Number(first.sender_id) === Number(userId) ? first.receiver_id : first.sender_id) ||
      ownerId
    );

    let otherName = meta.otherName;
    if (isBadName(otherName)) {
      const otherRow = messages.find((m) => Number(m.sender_id) !== Number(userId));
      otherName = await resolveCleanSenderName(receiverId, otherRow?.sender_name || '');
    }

    let myName = getUserDisplayName(ctx.from);
    if (myName === 'مراسل') myName = await resolveCleanSenderName(userId, '');
    if (myName === 'مراسل') myName = 'أنا';

    const cardText = formatSingleThreadCard(userId, view, { otherName, myName, propertyId });

    const prevSession = messengerSession[userId] || {};
    const targetMsgId = editMessageId || prevSession.cardMessageId || null;
    const msgId = await upsertCard(ctx, userId, cardText, threadKeyboard(), targetMsgId, forceNew);

    messengerSession[userId] = {
      mode: 'thread',
      threadId,
      propertyId,
      ownerId,
      receiverId,
      otherName,
      cardMessageId: msgId,
      page: view.page,
      totalPages: view.totalPages
    };
    return msgId;
  }

  async function startPropertyMessage(ctx, propertyItem) {
    const userId = ctx.from.id;
    const ownerId = Number(propertyItem?.user_id);
    const propertyId = Number(propertyItem?.id);

    if (!propertyId || !ownerId) {
      return ctx.answerCbQuery('⚠️ بيانات المالك غير متوفرة لهذا العقار.', { show_alert: true }).catch(() => {});
    }
    if (ownerId === Number(userId)) {
      return ctx.answerCbQuery('ℹ️ هذا العقار منشور بحسابك.', { show_alert: true }).catch(() => {});
    }

    const ownerName = await resolveCleanSenderName(ownerId, 'صاحب العقار');
    const threadId = buildThreadId(propertyId, ownerId, userId);
    const meta = { propertyId, ownerId, receiverId: ownerId, otherName: ownerName };

    const { data: existing } = await supabase
      .from('messanger')
      .select('id')
      .eq('thread_id', threadId)
      .limit(1);

    // محادثة موجودة: نفتحها مباشرة
    if (Array.isArray(existing) && existing.length > 0) {
      delete userState[userId];
      return renderActiveThread(ctx, userId, threadId, meta, { forceNew: true });
    }

    userState[userId] = {
      step: 'composing_property_message',
      data: { threadId, ...meta },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const sent = await replyTracked(
      ctx,
      userId,
      `💬 <b>${escapeHtml(ownerName)}</b>\n🏠 <i>عقار #${propertyId}</i>\n${LINE}\n✍️ اكتب رسالتك الأولى الآن:`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([[BTN_HOME]]).resize()
      },
      true
    );
    if (sent?.message_id) userState[userId].wizardMsgId = sent.message_id;
  }

  // ───────── معالجة النصوص ─────────
  async function handleMessengerText(ctx) {
    const userId = ctx.from.id;
    const rawText = ctx.message?.text ? ctx.message.text.trim() : '';
    if (!rawText || rawText.startsWith('/')) return false;

    const st = userState[userId];
    const sess = messengerSession[userId];

    // الرئيسية: ننظف جلسة المراسلات ونترك الـ core يعرض القائمة
    if (rawText === BTN_HOME) {
      if (sess?.cardMessageId && ctx.chat?.id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, sess.cardMessageId).catch(() => {});
      }
      delete messengerSession[userId];
      return false;
    }

    // الرجوع لقائمة المراسلين
    if (rawText === BTN_BACK && sess) {
      await safeDeleteUserMessage(ctx);
      await showInboxList(ctx);
      return true;
    }

    // ── أزرار السجل (داخل محادثة فقط) ──
    if (sess?.mode === 'thread' && sess.threadId) {
      const navTargets = {
        [BTN_PREV]: (sess.page || 0) + 1, // أقدم
        [BTN_NEXT]: Math.max(0, (sess.page || 0) - 1), // أحدث
        [BTN_REFRESH]: sess.page || 0
      };

      if (rawText in navTargets) {
        await safeDeleteUserMessage(ctx);
        await renderActiveThread(ctx, userId, sess.threadId, sess, {
          editMessageId: sess.cardMessageId,
          page: navTargets[rawText]
        });
        return true;
      }
    }

    // اختيار محادثة من أزرار القائمة السفلية
    if (sess?.mode === 'list' && sess.senderMap?.[rawText]) {
      await safeDeleteUserMessage(ctx);
      const target = sess.senderMap[rawText];
      await renderActiveThread(
        ctx,
        userId,
        target.threadId,
        {
          propertyId: target.propertyId,
          ownerId: target.ownerId,
          receiverId: target.otherId,
          otherName: target.cleanName
        },
        { editMessageId: sess.cardMessageId, forceNew: true, page: 0 }
      );
      return true;
    }

    // أول رسالة على عقار
    if (st && st.step === 'composing_property_message') {
      await safeDeleteUserMessage(ctx);
      const { threadId, propertyId, ownerId, receiverId, otherName, wizardMsgId } = st.data || {};
      delete userState[userId];

      if (wizardMsgId && ctx.chat?.id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, wizardMsgId).catch(() => {});
      }

      await insertMessage({
        propertyId,
        ownerId,
        senderId: userId,
        receiverId,
        senderName: getUserDisplayName(ctx.from),
        message: rawText
      });

      await renderActiveThread(
        ctx, userId, threadId,
        { propertyId, ownerId, receiverId, otherName },
        { forceNew: true, page: 0 }
      );
      return true;
    }

    // رسالة داخل محادثة مفتوحة: نحذف رسالة المستخدم ونرجع لآخر الرسائل
    if (sess?.mode === 'thread' && sess.threadId) {
      await safeDeleteUserMessage(ctx);

      await insertMessage({
        propertyId: sess.propertyId,
        ownerId: sess.ownerId,
        senderId: userId,
        receiverId: sess.receiverId,
        senderName: getUserDisplayName(ctx.from),
        message: rawText
      });

      await renderActiveThread(ctx, userId, sess.threadId, sess, {
        editMessageId: sess.cardMessageId,
        page: 0
      });
      return true;
    }

    return false;
  }

  // ───────── الأوامر ─────────
  core.bot.hears(/^💬 المراسلات(?: \(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await showInboxList(ctx);
  });

  // الزر الوحيد inline هو زر "مراسلة المالك" داخل بطاقة العقار
  core.bot.action(/^msg_prop:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await startPropertyMessage(ctx, { id: Number(ctx.match[1]), user_id: Number(ctx.match[2]) });
  });

  // توافق مع بطاقات قديمة قد تحمل هذه الأزرار
  core.bot.action('msg_list', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await showInboxList(ctx);
  });

  core.bot.action(/^msg_open:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const msgId = ctx.callbackQuery?.message?.message_id || null;
    await renderActiveThread(ctx, ctx.from.id, ctx.match[1], {}, { editMessageId: msgId, forceNew: true });
  });

  return {
    messengerSession,
    buildThreadId,
    getUnreadCount,
    getMessengerButtonLabel,
    insertMessage,
    fetchSenderThreads,
    openThreadMessages,
    formatSingleThreadCard,
    showInboxList,
    renderActiveThread,
    startPropertyMessage,
    handleMessengerText
  };
}

module.exports = { createMessengerModule };
