'use strict';

function buildThreadId(propertyId, ownerId, otherUserId) {
  return `p_${Number(propertyId)}_o_${Number(ownerId)}_u_${Number(otherUserId)}`;
}

// ───────── إعدادات العرض ─────────
const LRM = '\u200E'; // الطرف الآخر: يسار
const RLM = '\u200F'; // أنا: يمين
const TIMEZONE = 'Africa/Algiers';
const PAGE_SIZE = 30;
const NAME_CACHE_TTL = 60 * 60 * 1000;
const LINE = '▬▬▬▬▬▬▬▬▬▬▬▬';
const ALBUM_FLUSH_MS = 650; // مهلة تجميع عدة صور أو عدة فيديوهات مرسلة كألبوم واحد
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

function isSafeHttpUrl(url) {
  const s = String(url || '').trim();
  return /^https?:\/\//i.test(s);
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
  //   receiverId, otherName, cardMessageId, page, mediaMap }
  const messengerSession = {};

  // كاش الأسماء: id → { name, at }
  const nameCache = new Map();

  // مخزن مؤقت لتجميع الألبومات (عدة صور أو عدة فيديوهات بنفس media_group_id)
  const pendingAlbums = new Map();

  function nameFromTelegramObj(obj) {
    if (!obj) return '';
    const full = [obj.first_name, obj.last_name].filter(Boolean).join(' ').trim();
    if (!isBadName(full)) return full;
    if (!isBadName(obj.username)) return String(obj.username).trim();
    return '';
  }

  function getUserDisplayName(from) {
    return nameFromTelegramObj(from) || 'مراسل';
  }

  async function fetchTelegramName(userId) {
    try {
      const chat = await core.bot.telegram.getChat(Number(userId));
      return nameFromTelegramObj(chat);
    } catch (_) {
      return '';
    }
  }

  async function resolveCleanSenderName(otherUserId, fallbackSenderName = '') {
    const id = Number(otherUserId);
    const cached = nameCache.get(id);
    if (cached && Date.now() - cached.at < NAME_CACHE_TTL) return cached.name;

    let name = id ? await fetchTelegramName(id) : '';

    if (!name && id) {
      try {
        const { data } = await supabase
          .from('users')
          .select('first_name, last_name, username')
          .eq('id', id)
          .limit(1);
        name = nameFromTelegramObj(Array.isArray(data) ? data[0] : data);
      } catch (_) {}
    }

    if (name) {
      nameCache.set(id, { name, at: Date.now() });
      return name;
    }

    const fallback = String(fallbackSenderName || '').trim();
    return isBadName(fallback) ? 'مراسل' : fallback;
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

  // تحويل file_id إلى رابط مباشر من تيليغرام
  async function fileIdToUrl(fileId) {
    if (!fileId) return '';
    try {
      const link = await core.bot.telegram.getFileLink(String(fileId).trim());
      return link ? String(link.href || link).trim() : '';
    } catch (e) {
      console.error('getFileLink error:', e?.message || e);
      return '';
    }
  }

  async function insertMessage({
    propertyId,
    ownerId,
    senderId,
    receiverId,
    senderName,
    messageType = 'text',
    message,
    mediaType = null,
    mediaUrls = null,
    mediaGroupId = null
  }) {
    const cleanMsg = String(message || '').trim();
    const urlsArray = Array.isArray(mediaUrls)
      ? mediaUrls.map((u) => String(u || '').trim()).filter(Boolean)
      : (typeof mediaUrls === 'string' && mediaUrls.trim()
          ? mediaUrls.split(/\s*\|\|\s*|\s*,\s*|\n+/).map((u) => u.trim()).filter(Boolean)
          : []);

    if (!cleanMsg && !urlsArray.length) return null;

    const pId = Number(propertyId);
    const oId = Number(ownerId);
    const sId = Number(senderId);
    const rId = Number(receiverId);
    const otherId = sId === oId ? rId : sId;
    const threadId = buildThreadId(pId, oId, otherId);

    const finalMessage = cleanMsg || urlsArray.join('\n');
    const payload = {
      thread_id: threadId,
      property_id: pId,
      owner_id: oId,
      sender_id: sId,
      receiver_id: rId,
      sender_name: String(senderName || 'مراسل').trim() || 'مراسل',
      message_type: messageType,
      message: finalMessage,
      media_type: mediaType || (urlsArray.length ? messageType : null),
      media_urls: urlsArray.length ? urlsArray.join(' || ') : null,
      media_group_id: mediaGroupId || null,
      is_read: false,
      is_closed: false,
      created_at: new Date().toISOString(),
      read_at: null
    };

    let { data, error } = await supabase
      .from('messanger')
      .insert([payload])
      .select()
      .single();

    // fallback إذا لم تكن الأعمدة الإضافية موجودة في جدول قديم
    if (error) {
      const fallbackPayload = {
        thread_id: payload.thread_id,
        property_id: payload.property_id,
        owner_id: payload.owner_id,
        sender_id: payload.sender_id,
        receiver_id: payload.receiver_id,
        sender_name: payload.sender_name,
        message_type: payload.message_type,
        message: payload.message,
        is_read: false,
        is_closed: false,
        created_at: payload.created_at,
        read_at: null
      };
      const retry = await supabase
        .from('messanger')
        .insert([fallbackPayload])
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

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

  // استخراج روابط الصور أو الفيديوهات والتعليق من رسالة الوسائط
  function extractMediaInfo(m) {
    const mType = String(m.media_type || m.message_type || '').toLowerCase();
    const isVideo = mType === 'video' || mType === 'videos';
    const isPhoto = mType === 'image' || mType === 'photo' || mType === 'images' || mType === 'photos';

    const rawUrls = String(m.media_urls || m.message || '').trim();
    const lines = rawUrls
      .split(/\s*\|\|\s*|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const urls = [];
    const captionParts = [];

    for (const part of lines) {
      if (isSafeHttpUrl(part)) {
        urls.push(part);
      } else {
        captionParts.push(part);
      }
    }

    return {
      isVideo,
      isPhoto: isPhoto || (!isVideo && urls.length > 0),
      urls,
      caption: captionParts.join(' ').trim()
    };
  }

  // ───────── تصميم بطاقة المحادثة + عرض روابط الصور والفيديوهات التفاعلية ─────────
  function formatSingleThreadCard(userId, view, meta = {}) {
    const uid = Number(userId);
    const { messages, totalPages, page } = view;
    const otherName = meta.otherName || 'مراسل';
    const myName = meta.myName || 'أنا';
    const propertyId = meta.propertyId || messages[0]?.property_id;
    const mediaMap = meta.mediaMap || {};

    const out = [];
    const previewButtons = [];
    let lastSender = null;
    let lastDay = null;
    let mediaCounter = 0;

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

      if (lastSender !== who) {
        out.push(
          mine
            ? `${RLM}${color} <b>${escapeHtml(myName)}</b>`
            : `${LRM}${color} <b>${escapeHtml(otherName)}</b>`
        );
      }
      lastSender = who;

      const mediaInfo = extractMediaInfo(m);
      if ((mediaInfo.isPhoto || mediaInfo.isVideo) && mediaInfo.urls.length > 0) {
        mediaCounter += 1;
        const kindLabel = mediaInfo.isVideo
          ? (mediaInfo.urls.length > 1 ? `فيديوهات (${mediaInfo.urls.length})` : 'فيديو')
          : (mediaInfo.urls.length > 1 ? `صور (${mediaInfo.urls.length})` : 'صورة');
        const kindIcon = mediaInfo.isVideo ? '🎬' : '🖼️';

        const key = `m_${m.id || mediaCounter}`;
        mediaMap[key] = {
          isVideo: mediaInfo.isVideo,
          urls: mediaInfo.urls,
          caption: mediaInfo.caption,
          senderName: mine ? myName : otherName
        };

        const linkLines = mediaInfo.urls.map((u, idx) => {
          const itemTitle = mediaInfo.urls.length > 1
            ? `${kindLabel} ${idx + 1}`
            : `فتح ال${kindLabel}`;
          return `${mark}🔗 <a href="${escapeHtml(u)}">${escapeHtml(itemTitle)}</a>`;
        });

        let block = `${mark}${color} ${kindIcon} <b>${escapeHtml(kindLabel)}</b>${stamp}\n` + linkLines.join('\n');
        if (mediaInfo.caption) {
          block += `\n${mark}${color} ${escapeHtml(mediaInfo.caption)}`;
        }
        out.push(`<blockquote>${block}</blockquote>`);

        previewButtons.push(
          Markup.button.callback(
            `${kindIcon} عرض #${mediaCounter}`,
            `msg_media:${key}`
          )
        );
      } else {
        const lines = String(m.message).split('\n').map(escapeHtml);
        lines[lines.length - 1] += stamp;
        const body = lines.map((l) => `${mark}${color} ${l}`).join('\n');
        out.push(`<blockquote>${body}</blockquote>`);
      }
    }

    const currentPage = totalPages - page;

    const header =
      `${LRM}💬 <b>${escapeHtml(otherName)}</b>` +
      (propertyId ? ` • 🏠 <i>#${propertyId}</i>` : '') +
      (totalPages > 1 ? ` • 📄 <b>${currentPage}/${totalPages}</b>` : '') +
      `\n${LINE}\n`;

    const body = out.length
      ? out.join('\n')
      : `<i>لا توجد رسائل بعد، اكتب رسالتك أو أرسل صورة أو فيديو 👇</i>`;

    const footer = `\n${LINE}\n✍️ <i>اكتب رسالتك أو أرسل صورة / فيديو</i>`;

    const inlineRows = [];
    for (let i = 0; i < previewButtons.length; i += 2) {
      inlineRows.push(previewButtons.slice(i, i + 2));
    }

    return {
      text: fitTelegramText(header + body + footer, false),
      inlineMarkup: inlineRows.length ? Markup.inlineKeyboard(inlineRows) : null
    };
  }

  function threadKeyboard() {
    return Markup.keyboard([
      [BTN_PREV, BTN_NEXT],
      [BTN_BACK, BTN_HOME]
    ]).resize();
  }

  function inboxKeyboard(labels) {
    const rows = [];
    for (let i = 0; i < labels.length; i += 2) rows.push(labels.slice(i, i + 2));
    rows.push([BTN_HOME]);
    return Markup.keyboard(rows).resize();
  }

  async function upsertCard(ctx, userId, cardObj, keyboardExtra, targetMsgId, forceNew = false) {
    const text = typeof cardObj === 'string' ? cardObj : cardObj.text;
    const inlineMarkup = typeof cardObj === 'string' ? null : cardObj.inlineMarkup;

    if (targetMsgId && ctx.chat?.id) {
      if (!forceNew) {
        try {
          await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, undefined, text, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup: inlineMarkup ? inlineMarkup.reply_markup : { inline_keyboard: [] }
          });
          return targetMsgId;
        } catch (e) {
          const desc = String(e?.description || e?.message || '');
          if (desc.includes('message is not modified')) return targetMsgId;
        }
      }
      await ctx.telegram.deleteMessage(ctx.chat.id, targetMsgId).catch(() => {});
    }

    const extraOpts = {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...keyboardExtra
    };

    if (inlineMarkup?.reply_markup?.inline_keyboard?.length) {
      extraOpts.reply_markup = {
        ...keyboardExtra.reply_markup,
        inline_keyboard: inlineMarkup.reply_markup.inline_keyboard
      };
    }

    const sent = await replyTracked(ctx, userId, text, extraOpts, true);
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
        `📭 <b>صندوق المراسلات فارغ</b>`,
        { parse_mode: 'HTML', ...core.getMainMenuKeyboard(userId, unreadCount) },
        true
      );
      return;
    }

    const senderMap = {};
    threads.forEach((t) => { senderMap[t.buttonText] = t; });

    const sent = await replyTracked(
      ctx,
      userId,
      `💬 <b>المراسلات</b>\n👇 <i>اختر محادثة</i>`,
      { parse_mode: 'HTML', ...inboxKeyboard(Object.keys(senderMap)) },
      true
    );

    messengerSession[userId] = {
      mode: 'list',
      senderMap,
      cardMessageId: sent?.message_id || null
    };
  }

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

    const otherRow = messages.find((m) => Number(m.sender_id) !== Number(userId));
    const otherName = await resolveCleanSenderName(receiverId, otherRow?.sender_name || meta.otherName || '');

    let myName = getUserDisplayName(ctx.from);
    if (myName === 'مراسل') myName = await resolveCleanSenderName(userId, '');
    if (myName === 'مراسل') myName = 'أنا';

    const mediaMap = {};
    const cardObj = formatSingleThreadCard(userId, view, { otherName, myName, propertyId, mediaMap });

    const prevSession = messengerSession[userId] || {};
    const targetMsgId = editMessageId || prevSession.cardMessageId || null;
    const msgId = await upsertCard(ctx, userId, cardObj, threadKeyboard(), targetMsgId, forceNew);

    messengerSession[userId] = {
      mode: 'thread',
      threadId,
      propertyId,
      ownerId,
      receiverId,
      otherName,
      cardMessageId: msgId,
      page: view.page,
      totalPages: view.totalPages,
      mediaMap
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
      `💬 <b>${escapeHtml(ownerName)}</b> • 🏠 <i>#${propertyId}</i>\n${LINE}\n✍️ اكتب رسالتك الأولى أو أرسل صورة / فيديو:`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([[BTN_HOME]]).resize()
      },
      true
    );
    if (sent?.message_id) userState[userId].wizardMsgId = sent.message_id;
  }

  // حفظ دفعة وسائط (صورة واحدة أو عدة صور، فيديو واحد أو عدة فيديوهات) وتحويلها إلى روابط
  async function commitMediaBatch(ctx, userId, items, mediaType, mediaGroupId) {
    const st = userState[userId];
    const sess = messengerSession[userId];

    let targetCtx = null;
    let isFirstWizard = false;

    if (st && st.step === 'composing_property_message') {
      isFirstWizard = true;
      targetCtx = { ...(st.data || {}), wizardMsgId: st.wizardMsgId };
      delete userState[userId];
    } else if (sess?.mode === 'thread' && sess.threadId) {
      targetCtx = {
        threadId: sess.threadId,
        propertyId: sess.propertyId,
        ownerId: sess.ownerId,
        receiverId: sess.receiverId,
        otherName: sess.otherName,
        cardMessageId: sess.cardMessageId
      };
    } else {
      return false;
    }

    const urls = [];
    let caption = '';

    for (const item of items) {
      const url = await fileIdToUrl(item.fileId);
      if (url) urls.push(url);
      if (!caption && item.caption) caption = item.caption;
    }

    if (!urls.length) return false;

    if (isFirstWizard && targetCtx.wizardMsgId && ctx.chat?.id) {
      await ctx.telegram.deleteMessage(ctx.chat.id, targetCtx.wizardMsgId).catch(() => {});
    }

    await insertMessage({
      propertyId: targetCtx.propertyId,
      ownerId: targetCtx.ownerId,
      senderId: userId,
      receiverId: targetCtx.receiverId,
      senderName: getUserDisplayName(ctx.from),
      messageType: mediaType,
      message: caption || urls.join('\n'),
      mediaType,
      mediaUrls: urls,
      mediaGroupId: mediaGroupId || null
    });

    await renderActiveThread(
      ctx,
      userId,
      targetCtx.threadId,
      targetCtx,
      isFirstWizard
        ? { forceNew: true, page: 0 }
        : { editMessageId: targetCtx.cardMessageId, page: 0 }
    );

    return true;
  }

  // ───────── معالجة الصور والفيديوهات (فردية أو متعددة) ─────────
  async function handleMessengerMedia(ctx) {
    const userId = ctx.from?.id;
    if (!userId) return false;

    const st = userState[userId];
    const sess = messengerSession[userId];
    const activeForMessenger =
      (st && st.step === 'composing_property_message') ||
      (sess?.mode === 'thread' && sess.threadId);

    if (!activeForMessenger) return false;

    let mediaType = null;
    let fileId = '';

    if (Array.isArray(ctx.message?.photo) && ctx.message.photo.length > 0) {
      mediaType = 'image';
      fileId = ctx.message.photo[ctx.message.photo.length - 1]?.file_id || '';
    } else if (ctx.message?.video?.file_id) {
      mediaType = 'video';
      fileId = ctx.message.video.file_id;
    }

    if (!mediaType || !fileId) return false;

    await safeDeleteUserMessage(ctx);

    const caption = ctx.message?.caption ? ctx.message.caption.trim() : '';
    const groupId = ctx.message?.media_group_id ? String(ctx.message.media_group_id) : '';

    // إذا كان ضمن ألبوم (عدة صور أو عدة فيديوهات)، نجمّعها ثم نرسلها كرسالة واحدة متكاملة الروابط
    if (groupId) {
      const bucketKey = `${userId}:${groupId}`;
      let bucket = pendingAlbums.get(bucketKey);

      if (!bucket) {
        bucket = {
          items: [],
          mediaType,
          timer: null
        };
        pendingAlbums.set(bucketKey, bucket);
      }

      bucket.items.push({ fileId, caption });

      if (bucket.timer) clearTimeout(bucket.timer);
      bucket.timer = setTimeout(async () => {
        pendingAlbums.delete(bucketKey);
        await commitMediaBatch(ctx, userId, bucket.items, bucket.mediaType, groupId);
      }, ALBUM_FLUSH_MS);

      return true;
    }

    return commitMediaBatch(ctx, userId, [{ fileId, caption }], mediaType, null);
  }

  // ───────── معالجة النصوص ─────────
  async function handleMessengerText(ctx) {
    const userId = ctx.from.id;
    const rawText = ctx.message?.text ? ctx.message.text.trim() : '';
    if (!rawText || rawText.startsWith('/')) return false;

    const st = userState[userId];
    const sess = messengerSession[userId];

    if (rawText === BTN_HOME) {
      if (sess?.cardMessageId && ctx.chat?.id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, sess.cardMessageId).catch(() => {});
      }
      delete messengerSession[userId];
      return false;
    }

    if (rawText === BTN_BACK && sess) {
      await safeDeleteUserMessage(ctx);
      await showInboxList(ctx);
      return true;
    }

    if (sess?.mode === 'thread' && sess.threadId && (rawText === BTN_PREV || rawText === BTN_NEXT)) {
      await safeDeleteUserMessage(ctx);
      const cur = sess.page || 0;
      const target = rawText === BTN_PREV ? cur + 1 : Math.max(0, cur - 1);
      await renderActiveThread(ctx, userId, sess.threadId, sess, {
        editMessageId: sess.cardMessageId,
        page: target
      });
      return true;
    }

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
        messageType: 'text',
        message: rawText
      });

      await renderActiveThread(
        ctx, userId, threadId,
        { propertyId, ownerId, receiverId, otherName },
        { forceNew: true, page: 0 }
      );
      return true;
    }

    if (sess?.mode === 'thread' && sess.threadId) {
      await safeDeleteUserMessage(ctx);

      await insertMessage({
        propertyId: sess.propertyId,
        ownerId: sess.ownerId,
        senderId: userId,
        receiverId: sess.receiverId,
        senderName: getUserDisplayName(ctx.from),
        messageType: 'text',
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

  // ───────── الأوامر والأحداث ─────────
  core.bot.on(['photo', 'video'], async (ctx, next) => {
    const handled = await handleMessengerMedia(ctx);
    if (!handled && typeof next === 'function') return next();
  });

  core.bot.hears(/^💬 المراسلات(?: \(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await showInboxList(ctx);
  });

  // عرض الوسائط مباشرة داخل المحادثة عند الضغط على زر "عرض #..."
  core.bot.action(/^msg_media:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;
    const key = ctx.match[1];
    const info = messengerSession[userId]?.mediaMap?.[key];
    if (!info || !Array.isArray(info.urls) || !info.urls.length) return;

    const closeKb = Markup.inlineKeyboard([
      [Markup.button.callback('✖️ إغلاق العرض', 'msg_media_close')]
    ]);

    for (let i = 0; i < info.urls.length; i += 1) {
      const url = info.urls[i];
      const cap =
        `<b>${escapeHtml(info.senderName || 'مراسل')}</b>` +
        (info.urls.length > 1 ? ` • (${i + 1}/${info.urls.length})` : '') +
        (info.caption ? `\n${escapeHtml(info.caption)}` : '');

      if (info.isVideo) {
        await ctx.replyWithVideo(url, {
          caption: cap,
          parse_mode: 'HTML',
          ...closeKb
        }).catch(async () => {
          await ctx.reply(`🎬 <a href="${escapeHtml(url)}">فتح الفيديو</a>`, {
            parse_mode: 'HTML',
            ...closeKb
          }).catch(() => {});
        });
      } else {
        await ctx.replyWithPhoto(url, {
          caption: cap,
          parse_mode: 'HTML',
          ...closeKb
        }).catch(async () => {
          await ctx.reply(`🖼️ <a href="${escapeHtml(url)}">فتح الصورة</a>`, {
            parse_mode: 'HTML',
            ...closeKb
          }).catch(() => {});
        });
      }
    }
  });

  core.bot.action('msg_media_close', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (ctx.chat?.id && ctx.callbackQuery?.message?.message_id) {
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.callbackQuery.message.message_id).catch(() => {});
    }
  });

  core.bot.action(/^msg_prop:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await startPropertyMessage(ctx, { id: Number(ctx.match[1]), user_id: Number(ctx.match[2]) });
  });

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
    handleMessengerText,
    handleMessengerMedia
  };
}

module.exports = { createMessengerModule };
