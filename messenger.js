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
const ALBUM_FLUSH_MS = 650;
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

const BTN_PREV = '◀️ السابق';
const BTN_NEXT = 'التالي ▶️';
const BTN_BACK = '⬅️ قائمة المراسلين';
const BTN_HOME = '🏠 القائمة الرئيسية';
const BTN_BACK_TO_THREAD = '↩️ رجوع للمحادثة';

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

function looksLikeRawTelegramFileId(val) {
  const s = String(val || '').trim();
  return /^A[A-Za-z0-9_-]{25,}$/.test(s) && !/\s/.test(s);
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

  const normalizeMediaRef = core.normalizeMediaRef || ((v) => {
    const s = String(v || '').trim();
    if (!s || s === 'EMPTY' || s === 'FREE_NO_RECEIPT') return null;
    return s.startsWith('tg:') ? s.slice(3) : s;
  });

  const buildOrderedBrowsingMedia = core.buildOrderedBrowsingMedia || ((item) => {
    const list = [];
    const imgs = String(item?.image_url || '')
      .split(/[|\n]+/)
      .map((s) => s.trim())
      .filter((s) => s && s !== 'EMPTY');
    for (const r of imgs) {
      const ref = normalizeMediaRef(r);
      if (ref) list.push({ type: 'photo', ref });
    }
    const vids = String(item?.video_url || '')
      .split(/[|\n]+/)
      .map((s) => s.trim())
      .filter((s) => s && s !== 'EMPTY');
    for (const r of vids) {
      const ref = normalizeMediaRef(r);
      if (ref) list.push({ type: 'video', ref });
    }
    return list;
  });

  const formatMoney = core.formatMoney || ((val) => {
    if (val === undefined || val === null || val === '') return 'غير محدد';
    return `${Number(val).toLocaleString('en-US')} دج`;
  });

  const formatDateTime = core.formatDateTime || ((iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-GB', { timeZone: TIMEZONE });
    } catch (_) {
      return String(iso);
    }
  });

  const messengerSession = {};
  const nameCache = new Map();
  const pendingAlbums = new Map();

  function getTelegramClient(ctx) {
    return core.bot?.telegram || ctx?.telegram || null;
  }

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
      const tg = getTelegramClient();
      if (!tg) return '';
      const chat = await tg.getChat(Number(userId));
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

  // إشعار فوري ومضمون للطرف الآخر عند وصول أي رسالة
  async function notifyReceiverMessenger(ctx, {
    threadId,
    propertyId,
    senderId,
    receiverId,
    senderName,
    messageType = 'text',
    messageText = '',
    mediaCount = 0
  }) {
    const sId = Number(senderId);
    const rId = Number(receiverId);
    if (!rId || !threadId || sId === rId) return false;

    const telegramApi = getTelegramClient(ctx);
    if (!telegramApi) {
      console.error('notifyReceiverMessenger: Telegram client is not available');
      return false;
    }

    let cleanSender = String(senderName || '').trim();
    if (isBadName(cleanSender)) {
      cleanSender = await resolveCleanSenderName(sId, 'مراسل');
    }

    let rawPreview = '';
    if (messageType === 'video') {
      rawPreview = mediaCount > 1 ? `🎬 أرسل ${mediaCount} فيديوهات` : '🎬 أرسل فيديو';
    } else if (messageType === 'image' || messageType === 'photo') {
      rawPreview = mediaCount > 1 ? `🖼️ أرسل ${mediaCount} صور` : '🖼️ أرسل صورة';
    } else {
      const snippet = String(messageText || '').trim().replace(/\s+/g, ' ');
      const shortSnippet = snippet.length > 100 ? `${snippet.slice(0, 100)}…` : snippet;
      rawPreview = shortSnippet ? `💬 ${shortSnippet}` : '💬 رسالة جديدة';
    }

    const propNumber = propertyId ? Number(propertyId) : 0;
    const propBadge = propNumber ? ` • 🏠 #${propNumber}` : '';
    const botUsername = ctx?.botInfo?.username || core.bot?.botInfo?.username || '';
    const deepLink = botUsername
      ? `https://t.me/${botUsername}?start=chat_${encodeURIComponent(threadId)}`
      : '';

    const htmlText =
      `🔔 <b>رسالة جديدة من ${escapeHtml(cleanSender)}</b>${propBadge ? ` • 🏠 <b>#${propNumber}</b>` : ''}\n` +
      `<blockquote>💬 ${escapeHtml(rawPreview.replace(/^💬\s*/, ''))}</blockquote>` +
      (deepLink ? `\n👉 <a href="${escapeHtml(deepLink)}">افتح المحادثة مباشرة</a>` : '');

    const plainText =
      `🔔 رسالة جديدة من ${cleanSender}${propBadge}\n` +
      `${rawPreview}` +
      (deepLink ? `\nرابط المحادثة: ${deepLink}` : '');

    const inlineKeyboard = Markup.inlineKeyboard([
      [Markup.button.callback('💬 فتح المحادثة الآن', `msg_open:${threadId}`)]
    ]);

    let delivered = false;
    try {
      await telegramApi.sendMessage(rId, htmlText, {
        parse_mode: 'HTML',
        disable_notification: false,
        link_preview_options: { is_disabled: true },
        ...inlineKeyboard
      });
      delivered = true;
    } catch (e) {
      const errDesc = String(e?.description || e?.message || '');
      if (errDesc.includes('bot was blocked') || errDesc.includes('chat not found') || errDesc.includes('user is deactivated')) {
        console.warn(`notifyReceiverMessenger skipped for ${rId}: ${errDesc}`);
        return false;
      }
      try {
        await telegramApi.sendMessage(rId, plainText, {
          disable_notification: false,
          ...inlineKeyboard
        });
        delivered = true;
      } catch (retryErr) {
        console.error('notifyReceiverMessenger fallback failed:', retryErr?.message || retryErr);
      }
    }

    const recSess = messengerSession[rId];
    if (recSess?.mode === 'thread' && recSess.threadId === threadId && recSess.cardMessageId) {
      try {
        const view = await openThreadMessages(rId, threadId, 0);
        const recName = await resolveCleanSenderName(sId, cleanSender);
        let myRecName = await resolveCleanSenderName(rId, '');
        if (!myRecName || myRecName === 'مراسل') myRecName = 'أنا';
        const cardObj = formatSingleThreadCard(rId, view, {
          otherName: recName,
          myName: myRecName,
          propertyId: propNumber || recSess.propertyId,
          botUsername
        });
        await telegramApi.editMessageText(rId, recSess.cardMessageId, undefined, cardObj.text, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: cardObj.inlineMarkup ? cardObj.inlineMarkup.reply_markup : { inline_keyboard: [] }
        }).catch(() => {});
      } catch (_) {}
    }

    return delivered;
  }

  // رفع الوسائط إلى test_media وجلب الرابط العام (publicUrl) بنفس أسلوب Users
  async function uploadMediaToTestMedia(ctx, fileId, mediaType, index = 0) {
    if (!fileId) return '';
    try {
      const tg = getTelegramClient(ctx);
      const fileLink = await tg.getFileLink(String(fileId).trim());
      const res = await fetch(fileLink.href);
      const buf = Buffer.from(await res.arrayBuffer());
      const isVideo = mediaType === 'video';
      const ext = isVideo ? 'mp4' : 'jpg';
      const mime = isVideo ? 'video/mp4' : 'image/jpeg';
      const fileName = `${Date.now()}_${index}_msg_${mediaType}.${ext}`;

      await supabase.storage.from('test_media').upload(fileName, buf, { contentType: mime, upsert: true });
      const { data: pubUrl } = supabase.storage.from('test_media').getPublicUrl(fileName);
      if (pubUrl && pubUrl.publicUrl) return pubUrl.publicUrl;
    } catch (e) {
      console.error('uploadMediaToTestMedia error:', e?.message || e);
    }

    try {
      const tg = getTelegramClient(ctx);
      const fallbackLink = await tg.getFileLink(String(fileId).trim());
      return fallbackLink ? String(fallbackLink.href || fallbackLink).trim() : '';
    } catch (_) {
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
    mediaGroupId = null,
    ctx = null
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

    const finalMessage = cleanMsg || urlsArray.join(' || ');
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

    await notifyReceiverMessenger(ctx, {
      threadId,
      propertyId: pId,
      senderId: sId,
      receiverId: rId,
      senderName: payload.sender_name,
      messageType,
      messageText: cleanMsg,
      mediaCount: urlsArray.length
    });

    return data;
  }

  // التحقق من الطرفين (uid و otherId) واستخراج العقارات المشتركة بينهما دون تكرار
  async function fetchSenderThreads(userId) {
    const uid = Number(userId);
    if (!uid) return [];

    try {
      const { data, error } = await supabase
        .from('messanger')
        .select('id, thread_id, property_id, owner_id, sender_id, receiver_id, sender_name, is_read, is_closed, created_at')
        .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
        .eq('is_closed', false)
        .order('created_at', { ascending: false })
        .limit(300);

      if (error || !Array.isArray(data)) return [];

      const usersMap = new Map();

      for (const row of data) {
        const sId = Number(row.sender_id);
        const rId = Number(row.receiver_id);
        const otherId = sId === uid ? rId : sId;

        if (!otherId || otherId === uid) continue;
        if (sId !== uid && rId !== uid) continue;

        if (!usersMap.has(otherId)) {
          usersMap.set(otherId, {
            otherId,
            rawSenderName: '',
            totalUnread: 0,
            propsMap: new Map()
          });
        }

        const userEntry = usersMap.get(otherId);
        if (!userEntry.rawSenderName && sId === otherId && row.sender_name) {
          userEntry.rawSenderName = row.sender_name;
        }

        const propId = Number(row.property_id) || 0;
        const propKey = String(propId);
        const tId = row.thread_id || buildThreadId(propId, row.owner_id, otherId);

        if (!userEntry.propsMap.has(propKey)) {
          userEntry.propsMap.set(propKey, {
            threadId: tId,
            propertyId: propId,
            ownerId: Number(row.owner_id) || 0,
            otherId,
            unreadCount: 0,
            lastCreatedAt: row.created_at
          });
        }

        const propEntry = userEntry.propsMap.get(propKey);
        if (rId === uid && sId !== uid && row.is_read === false) {
          propEntry.unreadCount += 1;
          userEntry.totalUnread += 1;
        }
      }

      const result = [];

      for (const u of usersMap.values()) {
        const cleanName = await resolveCleanSenderName(u.otherId, u.rawSenderName);
        const propThreads = [...u.propsMap.values()].map((p) => ({
          ...p,
          cleanName
        }));

        if (propThreads.length === 1) {
          const single = propThreads[0];
          const buttonText = single.unreadCount > 0
            ? `🟢 ${cleanName} (${single.unreadCount})`
            : `👤 ${cleanName}`;

          result.push({
            ...single,
            cleanName,
            isGroup: false,
            buttonText
          });
        } else if (propThreads.length > 1) {
          const buttonText = u.totalUnread > 0
            ? `🟢 ${cleanName} (${u.totalUnread})`
            : `👤 ${cleanName}`;

          result.push({
            isGroup: true,
            otherId: u.otherId,
            cleanName,
            threads: propThreads,
            unreadCount: u.totalUnread,
            buttonText
          });
        }
      }

      return result;
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

  function extractMediaUrlsFromMessage(m) {
    const mType = String(m.media_type || m.message_type || '').toLowerCase();
    const isVideo = mType === 'video' || mType === 'videos';
    const isPhoto = mType === 'image' || mType === 'photo' || mType === 'images' || mType === 'photos';

    if (!isVideo && !isPhoto) return { isVideo: false, isPhoto: false, urls: [], caption: '' };

    const raw = String(m.media_urls || m.message || '').trim();
    const parts = raw
      .split(/\s*\|\|\s*|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const urls = [];
    const captionParts = [];

    for (const part of parts) {
      if (isSafeHttpUrl(part)) {
        urls.push(part);
      } else if (!looksLikeRawTelegramFileId(part)) {
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

  // فتح مرفق الرسالة مباشرة داخل المحادثة مع تفاصيل خفيفة (المرسل، الوقت، العقار، الوصف)
  async function renderMessageMediaDirectly(ctx, userId, msgId, mediaIdx = 0) {
    const id = Number(msgId);
    if (!id) return;

    let row = null;
    try {
      const { data } = await supabase
        .from('messanger')
        .select('*')
        .eq('id', id)
        .limit(1);
      row = Array.isArray(data) ? data[0] : data;
    } catch (_) {}

    if (!row) return;

    const currentSess = messengerSession[userId] || {};
    const returnThread = currentSess.mode === 'thread' && currentSess.threadId
      ? {
          threadId: currentSess.threadId,
          propertyId: currentSess.propertyId,
          ownerId: currentSess.ownerId,
          receiverId: currentSess.receiverId,
          otherName: currentSess.otherName,
          page: currentSess.page || 0
        }
      : (currentSess.returnThread || null);

    const info = extractMediaUrlsFromMessage(row);
    const safeIdx = Math.min(Math.max(0, Number(mediaIdx) || 0), Math.max(0, info.urls.length - 1));
    const mediaUrl = info.urls[safeIdx];
    if (!mediaUrl) return;

    const isMine = Number(row.sender_id) === Number(userId);
    let senderLabel = isMine ? getUserDisplayName(ctx.from) : '';
    if (!senderLabel || senderLabel === 'مراسل') {
      senderLabel = await resolveCleanSenderName(row.sender_id, row.sender_name || '');
    }
    if (isMine && (!senderLabel || senderLabel === 'مراسل')) senderLabel = 'أنا';

    const smallTime = formatSmallTime(row.created_at);
    const dayStr = dayLabel(row.created_at);
    const fullTime = row.created_at ? formatDateTime(row.created_at) : '';
    const timeLine = [dayStr, smallTime].filter(Boolean).join(' • ') || fullTime;

    const kindText = info.isVideo ? '🎬 فيديو' : '🖼️ صورة';
    const indexPart = info.urls.length > 1 ? ` <b>(${safeIdx + 1}/${info.urls.length})</b>` : '';
    const propPart = row.property_id ? `\n🏠 <b>العقار:</b> <code>#${Number(row.property_id)}</code>` : '';
    const descPart = info.caption ? `\n📝 <b>الوصف:</b> ${escapeHtml(info.caption)}` : '';

    const metaLines =
      `<blockquote>` +
      `${kindText}${indexPart}\n` +
      `👤 <b>المرسل:</b> ${escapeHtml(senderLabel)}` +
      (timeLine ? `\n🕒 <b>الوقت:</b> <i>${escapeHtml(timeLine)}</i>` : '') +
      propPart +
      descPart +
      `</blockquote>`;

    const caption = fitTelegramText(metaLines, true);
    const kb = Markup.keyboard([[BTN_BACK_TO_THREAD], [BTN_BACK, BTN_HOME]]).resize();

    let sentMsg = null;
    try {
      sentMsg = info.isVideo
        ? await ctx.replyWithVideo(mediaUrl, { caption, parse_mode: 'HTML', ...kb })
        : await ctx.replyWithPhoto(mediaUrl, { caption, parse_mode: 'HTML', ...kb });
    } catch (_) {}

    if (ctx.chat?.id) {
      if (currentSess.cardMessageId && currentSess.cardMessageId !== sentMsg?.message_id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, currentSess.cardMessageId).catch(() => {});
      }
      if (currentSess.propViewMessageId && currentSess.propViewMessageId !== sentMsg?.message_id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, currentSess.propViewMessageId).catch(() => {});
      }
    }

    messengerSession[userId] = {
      mode: 'media_view',
      msgId: id,
      mediaIdx: safeIdx,
      returnThread,
      propViewMessageId: sentMsg?.message_id || null
    };
  }

  // ───────── تصميم بطاقة المحادثة مع ترقيم الصفحات في الأسفل ─────────
  function formatSingleThreadCard(userId, view, meta = {}) {
    const uid = Number(userId);
    const { messages, totalPages, page } = view;
    const otherName = meta.otherName || 'مراسل';
    const myName = meta.myName || 'أنا';
    const propertyId = meta.propertyId || messages[0]?.property_id;
    const botUsername = meta.botUsername || core.bot?.botInfo?.username || '';

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

      if (lastSender !== who) {
        out.push(
          mine
            ? `${RLM}${color} <b>${escapeHtml(myName)}</b>`
            : `${LRM}${color} <b>${escapeHtml(otherName)}</b>`
        );
      }
      lastSender = who;

      const mediaInfo = extractMediaUrlsFromMessage(m);
      if ((mediaInfo.isPhoto || mediaInfo.isVideo) && mediaInfo.urls.length > 0) {
        const kindLabel = mediaInfo.isVideo
          ? (mediaInfo.urls.length > 1 ? `فيديوهات (${mediaInfo.urls.length})` : 'فيديو')
          : (mediaInfo.urls.length > 1 ? `صور (${mediaInfo.urls.length})` : 'صورة');
        const kindIcon = mediaInfo.isVideo ? '🎬' : '🖼️';

        const linkLines = mediaInfo.urls.map((u, idx) => {
          const itemTitle = mediaInfo.urls.length > 1
            ? `عرض ${kindLabel} ${idx + 1}`
            : `عرض ال${kindLabel}`;
          const openHref = botUsername && m.id
            ? `https://t.me/${botUsername}?start=m_${m.id}_${idx}`
            : u;
          return `${mark}🔗 <a href="${escapeHtml(openHref)}">${escapeHtml(itemTitle)}</a>`;
        });

        let block = `${mark}${color} ${kindIcon} <b>${escapeHtml(kindLabel)}</b>${stamp}\n` + linkLines.join('\n');
        if (mediaInfo.caption) {
          block += `\n${mark}${color} ${escapeHtml(mediaInfo.caption)}`;
        }
        out.push(`<blockquote>${block}</blockquote>`);
      } else {
        const cleanText = looksLikeRawTelegramFileId(m.message) ? '🖼️ صورة' : String(m.message);
        const lines = cleanText.split('\n').map(escapeHtml);
        lines[lines.length - 1] += stamp;
        const body = lines.map((l) => `${mark}${color} ${l}`).join('\n');
        out.push(`<blockquote>${body}</blockquote>`);
      }
    }

    const currentPage = totalPages - page;

    const propPart = propertyId
      ? (botUsername
          ? ` • <a href="https://t.me/${botUsername}?start=prop_${propertyId}">🏠 #${propertyId}</a>`
          : ` • 🏠 <b>#${propertyId}</b>`)
      : '';

    const header =
      `${LRM}💬 <b>${escapeHtml(otherName)}</b>` +
      propPart +
      `\n${LINE}\n`;

    const body = out.length
      ? out.join('\n')
      : `<blockquote><i>لا توجد رسائل بعد، اكتب رسالتك أو أرسل صورة أو فيديو 👇</i></blockquote>`;

    const pageBadge = totalPages > 1 ? ` • 📄 <b>${currentPage}/${totalPages}</b>` : '';
    const footer = `\n${LINE}\n✍️ <i>اكتب رسالتك أو أرسل صورة / فيديو</i>${pageBadge}`;

    const inlineMarkup = propertyId
      ? Markup.inlineKeyboard([
          [Markup.button.callback(`🏠 عرض الإعلان #${propertyId}`, `msg_prop_open:${propertyId}`)]
        ])
      : null;

    return {
      text: fitTelegramText(header + body + footer, false),
      inlineMarkup
    };
  }

  function threadKeyboard() {
    return Markup.keyboard([
      [BTN_PREV, BTN_NEXT],
      [BTN_BACK, BTN_HOME]
    ]).resize();
  }

  function propertyBrowseKeyboard(mediaIdx = 0, totalMedia = 0) {
    const rows = [];
    if (totalMedia > 1) {
      const mediaRow = [];
      if (mediaIdx > 0) mediaRow.push('🖼 الصورة السابقة');
      mediaRow.push(`📸 عنصر ${mediaIdx + 1} / ${totalMedia}`);
      if (mediaIdx < totalMedia - 1) mediaRow.push('الصورة التالية 🖼');
      rows.push(mediaRow);
    }
    rows.push([BTN_BACK_TO_THREAD]);
    rows.push([BTN_BACK, BTN_HOME]);
    return Markup.keyboard(rows).resize();
  }

  function inboxKeyboard(labels) {
    const rows = [];
    for (let i = 0; i < labels.length; i += 2) rows.push(labels.slice(i, i + 2));
    rows.push([BTN_HOME]);
    return Markup.keyboard(rows).resize();
  }

  function userPropertiesKeyboard(propLabels) {
    const rows = [];
    for (let i = 0; i < propLabels.length; i += 2) rows.push(propLabels.slice(i, i + 2));
    rows.push([BTN_BACK, BTN_HOME]);
    return Markup.keyboard(rows).resize();
  }

  async function showUserPropertyThreads(ctx, userId, groupItem, prevCardId = null) {
    const propMap = {};
    const labels = [];

    for (const t of groupItem.threads || []) {
      const lbl = t.unreadCount > 0
        ? `🟢 عقار #${t.propertyId} (${t.unreadCount})`
        : `🏠 عقار #${t.propertyId}`;
      propMap[lbl] = t;
      labels.push(lbl);
    }

    if (prevCardId && ctx.chat?.id) {
      await ctx.telegram.deleteMessage(ctx.chat.id, prevCardId).catch(() => {});
    }

    const sent = await replyTracked(
      ctx,
      userId,
      `👤 <b>${escapeHtml(groupItem.cleanName)}</b>\n👇 <i>اختر محادثة العقار</i>`,
      { parse_mode: 'HTML', ...userPropertiesKeyboard(labels) },
      true
    );

    messengerSession[userId] = {
      mode: 'user_properties',
      otherId: groupItem.otherId,
      otherName: groupItem.cleanName,
      propMap,
      cardMessageId: sent?.message_id || null
    };
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

  function setThreadReturnContext(userId, threadSess) {
    if (!userId || !threadSess?.threadId) return;
    messengerSession[userId] = {
      ...(messengerSession[userId] || {}),
      mode: 'property_view',
      returnThread: {
        threadId: threadSess.threadId,
        propertyId: threadSess.propertyId,
        ownerId: threadSess.ownerId,
        receiverId: threadSess.receiverId,
        otherName: threadSess.otherName,
        page: threadSess.page || 0
      }
    };
  }

  async function renderPropertyFromThread(ctx, userId, propertyId, mediaIndex = 0, isInitialOpen = false) {
    const propId = Number(propertyId);
    if (!propId) return;

    const currentSess = messengerSession[userId];
    if (isInitialOpen && currentSess?.mode === 'thread' && currentSess.threadId) {
      setThreadReturnContext(userId, currentSess);
    }

    let prop = null;
    try {
      const { data } = await supabase
        .from('test_messages')
        .select('*')
        .eq('id', propId)
        .limit(1);
      prop = Array.isArray(data) ? data[0] : data;
    } catch (_) {}

    if (!prop) {
      try {
        const { data } = await supabase
          .from('pending_properties')
          .select('*')
          .eq('id', propId)
          .limit(1);
        prop = Array.isArray(data) ? data[0] : data;
      } catch (_) {}
    }

    const returnThread = messengerSession[userId]?.returnThread || null;

    if (!prop) {
      const sent = await replyTracked(
        ctx,
        userId,
        `<blockquote>⚠️ <b>الإعلان #${propId} غير متوفر حالياً.</b></blockquote>`,
        { parse_mode: 'HTML', ...propertyBrowseKeyboard(0, 0) },
        true
      );
      messengerSession[userId] = {
        mode: 'property_view',
        propertyId: propId,
        mediaIndex: 0,
        returnThread,
        propViewMessageId: sent?.message_id || null
      };
      return;
    }

    const orderedMedia = buildOrderedBrowsingMedia(prop);
    const totalMedia = orderedMedia.length;
    let safeMediaIndex = Number(mediaIndex) || 0;
    if (safeMediaIndex < 0) safeMediaIndex = 0;
    if (totalMedia > 0 && safeMediaIndex >= totalMedia) safeMediaIndex = totalMedia - 1;

    const currentMedia = totalMedia > 0 ? orderedMedia[safeMediaIndex] : null;
    const mediaTypeLabel = currentMedia ? (currentMedia.type === 'video' ? '🎥 فيديو' : '🖼 صورة') : '';
    const mediaLine = totalMedia > 0 ? `\n${mediaTypeLabel}: <b>${safeMediaIndex + 1} / ${totalMedia}</b>` : '';
    const publishedAtText = prop.created_at ? formatDateTime(prop.created_at) : 'غير مسجل';

    const rawCaption =
      `🏛 <b>الولاية:</b> ${escapeHtml(prop.state_name || '')} • 🏠 <code>#${propId}</code>\n\n` +
      `<blockquote>` +
      `🏠 <b>العقار:</b> ${escapeHtml(prop.property_type || '')}\n` +
      `💰 <b>السعر:</b> ${formatMoney(prop.price)}\n` +
      `📞 <b>هاتف المالك:</b> <code>${escapeHtml(prop.phone || '')}</code>\n` +
      `🕒 <b>تاريخ ووقت النشر:</b> <code>${escapeHtml(publishedAtText)}</code>${mediaLine}\n` +
      `📝 <b>الوصف:</b> ${escapeHtml(prop.description || prop.message || '')}` +
      `</blockquote>`;

    const caption = fitTelegramText(rawCaption, !!currentMedia);
    const replyKb = propertyBrowseKeyboard(safeMediaIndex, totalMedia);

    const prevCardId = isInitialOpen ? currentSess?.cardMessageId : null;
    const prevPropMsgId = messengerSession[userId]?.propViewMessageId;

    let sentMsg = null;
    if (currentMedia) {
      try {
        sentMsg = currentMedia.type === 'video'
          ? await ctx.replyWithVideo(currentMedia.ref, { caption, parse_mode: 'HTML', ...replyKb })
          : await ctx.replyWithPhoto(currentMedia.ref, { caption, parse_mode: 'HTML', ...replyKb });
      } catch (_) {}
    }
    if (!sentMsg) {
      sentMsg = await replyTracked(ctx, userId, caption, { parse_mode: 'HTML', ...replyKb }, true);
    }

    if (ctx.chat?.id) {
      if (prevCardId && prevCardId !== sentMsg?.message_id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, prevCardId).catch(() => {});
      }
      if (prevPropMsgId && prevPropMsgId !== sentMsg?.message_id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, prevPropMsgId).catch(() => {});
      }
    }

    messengerSession[userId] = {
      mode: 'property_view',
      propertyId: propId,
      mediaIndex: safeMediaIndex,
      totalMedia,
      returnThread,
      propViewMessageId: sentMsg?.message_id || null
    };
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
    if (prev.propViewMessageId && ctx.chat?.id) {
      await ctx.telegram.deleteMessage(ctx.chat.id, prev.propViewMessageId).catch(() => {});
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

    const botUsername = ctx?.botInfo?.username || core.bot?.botInfo?.username || '';
    const cardObj = formatSingleThreadCard(userId, view, {
      otherName,
      myName,
      propertyId,
      botUsername
    });

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
      `💬 <b>${escapeHtml(ownerName)}</b> • 🏠 <i>#${propertyId}</i>\n${LINE}\n<blockquote>✍️ اكتب رسالتك الأولى أو أرسل صورة / فيديو:</blockquote>`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([[BTN_HOME]]).resize()
      },
      true
    );
    if (sent?.message_id) userState[userId].wizardMsgId = sent.message_id;
  }

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

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const pubUrl = await uploadMediaToTestMedia(ctx, item.fileId, mediaType, i);
      if (pubUrl) urls.push(pubUrl);
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
      mediaGroupId: mediaGroupId || null,
      ctx
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
      if (sess?.propViewMessageId && ctx.chat?.id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, sess.propViewMessageId).catch(() => {});
      }
      delete messengerSession[userId];
      return false;
    }

    if (sess?.mode === 'property_view' && sess.propertyId) {
      if (rawText === 'الصورة التالية 🖼') {
        await safeDeleteUserMessage(ctx);
        await renderPropertyFromThread(ctx, userId, sess.propertyId, (sess.mediaIndex || 0) + 1, false);
        return true;
      }
      if (rawText === '🖼 الصورة السابقة') {
        await safeDeleteUserMessage(ctx);
        await renderPropertyFromThread(ctx, userId, sess.propertyId, Math.max((sess.mediaIndex || 0) - 1, 0), false);
        return true;
      }
      if (/^📸 (صورة|عنصر) \d+ \/ \d+$/.test(rawText)) {
        await safeDeleteUserMessage(ctx);
        await renderPropertyFromThread(ctx, userId, sess.propertyId, sess.mediaIndex || 0, false);
        return true;
      }
    }

    if (rawText === BTN_BACK_TO_THREAD) {
      await safeDeleteUserMessage(ctx);
      const ret = messengerSession[userId]?.returnThread;
      const viewMsgId = messengerSession[userId]?.propViewMessageId;
      if (viewMsgId && ctx.chat?.id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, viewMsgId).catch(() => {});
      }
      if (ret?.threadId) {
        await renderActiveThread(ctx, userId, ret.threadId, ret, {
          forceNew: true,
          page: ret.page || 0
        });
      } else {
        await showInboxList(ctx);
      }
      return true;
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

    if (sess?.mode === 'user_properties' && sess.propMap?.[rawText]) {
      await safeDeleteUserMessage(ctx);
      const chosen = sess.propMap[rawText];
      await renderActiveThread(
        ctx,
        userId,
        chosen.threadId,
        {
          propertyId: chosen.propertyId,
          ownerId: chosen.ownerId,
          receiverId: chosen.otherId,
          otherName: chosen.cleanName || sess.otherName
        },
        { editMessageId: sess.cardMessageId, forceNew: true, page: 0 }
      );
      return true;
    }

    if (sess?.mode === 'list' && sess.senderMap?.[rawText]) {
      await safeDeleteUserMessage(ctx);
      const target = sess.senderMap[rawText];
      if (target.isGroup && Array.isArray(target.threads) && target.threads.length > 1) {
        await showUserPropertyThreads(ctx, userId, target, sess.cardMessageId);
        return true;
      }
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
        message: rawText,
        ctx
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
        message: rawText,
        ctx
      });

      await renderActiveThread(ctx, userId, sess.threadId, sess, {
        editMessageId: sess.cardMessageId,
        page: 0
      });
      return true;
    }

    return false;
  }

  core.bot.start(async (ctx, next) => {
    const payload = String(ctx.startPayload || '').trim();
    const matchChat = payload.match(/^chat_(.+)$/);
    if (matchChat) {
      await safeDeleteUserMessage(ctx);
      delete userState[ctx.from.id];
      delete browsingSession[ctx.from.id];
      delete supportUserSession[ctx.from.id];
      await renderActiveThread(ctx, ctx.from.id, decodeURIComponent(matchChat[1]), {}, { forceNew: true, page: 0 });
      return;
    }
    const matchProp = payload.match(/^prop_(\d+)$/);
    if (matchProp) {
      await safeDeleteUserMessage(ctx);
      await renderPropertyFromThread(ctx, ctx.from.id, Number(matchProp[1]), 0, true);
      return;
    }
    const matchMedia = payload.match(/^m_(\d+)_(\d+)$/);
    if (matchMedia) {
      await safeDeleteUserMessage(ctx);
      await renderMessageMediaDirectly(ctx, ctx.from.id, Number(matchMedia[1]), Number(matchMedia[2]));
      return;
    }
    if (typeof next === 'function') return next();
  });

  core.bot.action(/^msg_prop_open:(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await renderPropertyFromThread(ctx, ctx.from.id, Number(ctx.match[1]), 0, true);
  });

  core.bot.on(['photo', 'video'], async (ctx, next) => {
    const handled = await handleMessengerMedia(ctx);
    if (!handled && typeof next === 'function') return next();
  });

  core.bot.hears(/^💬 المراسلات(?: \(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await showInboxList(ctx);
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
    notifyReceiverMessenger,
    fetchSenderThreads,
    openThreadMessages,
    formatSingleThreadCard,
    showInboxList,
    showUserPropertyThreads,
    renderActiveThread,
    renderPropertyFromThread,
    renderMessageMediaDirectly,
    startPropertyMessage,
    handleMessengerText,
    handleMessengerMedia
  };
}

module.exports = { createMessengerModule };
