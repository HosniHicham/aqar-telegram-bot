'use strict';
// =========================================================================
// ⚙️ SERVICE LAYER — طبقة الخدمات المشتركة وإعدادات التطبيق (app_settings)
// يجمع:
// 1. قراءة وتخزين إعدادات app_settings مع كاش مؤقت وتحديث فوري
// 2. توليد أزرار المبالغ الديناميكية من مفاتيح topup_amount_1, topup_amount_2, ...
// 3. دوال التنسيق (المبالغ، الأرقام، التواريخ، الهروب من HTML، قص النصوص بأمان)
// 4. دوال الوسائط والصور والفيديو وحسابات المحفظة والنقاط والاستعلامات
// =========================================================================

const SETTINGS_CACHE_TTL_MS = 30 * 1000; // 30 ثانية كاش لتخفيف الضغط على قاعدة البيانات

module.exports = function createServiceLayer({
  supabase,
  Markup,
  MAX_PROPERTY_IMAGES = 10,
  getAdminIds = async () => []
}) {
  if (!supabase) {
    throw new Error('createServiceLayer requires a valid supabase client');
  }

  const settingsCache = new Map(); // key -> { value, expiresAt }
  let allSettingsCache = { items: null, expiresAt: 0 };

  function replacePlaceholders(templateStr = '', vars = {}) {
    let out = String(templateStr ?? '').replace(/\\n/g, '\n');
    for (const [k, v] of Object.entries(vars || {})) {
      out = out.split(`{${k}}`).join(String(v ?? ''));
    }
    return out;
  }

  function clearSettingsCache() {
    settingsCache.clear();
    allSettingsCache = { items: null, expiresAt: 0 };
  }

  async function getSetting(key, fallback = null, { forceRefresh = false } = {}) {
    if (!key) return fallback;
    const now = Date.now();

    if (!forceRefresh) {
      const cached = settingsCache.get(key);
      if (cached && cached.expiresAt > now) {
        return cached.value !== undefined && cached.value !== null ? cached.value : fallback;
      }
    }

    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();

      if (!error && data && data.value !== undefined && data.value !== null) {
        settingsCache.set(key, { value: data.value, expiresAt: now + SETTINGS_CACHE_TTL_MS });
        return data.value;
      }
    } catch (err) {
      console.error(`getSetting error for key "${key}":`, err.message);
    }

    return fallback;
  }

  async function getTextSetting(key, fallback = '', vars = {}, opts = {}) {
    const raw = await getSetting(key, fallback, opts);
    return replacePlaceholders(raw ?? fallback, vars);
  }

  async function setSetting(key, value, description = null) {
    if (!key) throw new Error('Setting key is required');
    const payload = {
      key: String(key).trim(),
      value: String(value ?? ''),
      updated_at: new Date().toISOString()
    };
    if (description !== null && description !== undefined) {
      payload.description = String(description);
    }

    const { data, error } = await supabase
      .from('app_settings')
      .upsert([payload], { onConflict: 'key' })
      .select()
      .single();

    if (error) throw error;
    clearSettingsCache();
    return data;
  }

  async function getAllSettings({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && Array.isArray(allSettingsCache.items) && allSettingsCache.expiresAt > now) {
      return allSettingsCache.items;
    }

    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('key, value, description, updated_at')
        .order('key', { ascending: true });

      if (error) throw error;
      const list = Array.isArray(data) ? data : [];
      allSettingsCache = { items: list, expiresAt: now + SETTINGS_CACHE_TTL_MS };
      for (const row of list) {
        settingsCache.set(row.key, { value: row.value, expiresAt: now + SETTINGS_CACHE_TTL_MS });
      }
      return list;
    } catch (err) {
      console.error('getAllSettings error:', err.message);
      return Array.isArray(allSettingsCache.items) ? allSettingsCache.items : [];
    }
  }

  // -----------------------------------------------------------------------
  // 🔢 أزرار المبالغ الديناميكية من app_settings (topup_amount_1, ...)
  // -----------------------------------------------------------------------
  function chunkButtons(items = [], perRow = 3) {
    const size = Math.max(1, Number(perRow) || 3);
    const out = [];
    for (let i = 0; i < items.length; i += size) {
      out.push(items.slice(i, i + size));
    }
    return out;
  }

  function sanitizeNumericPrice(val) {
    if (typeof val === 'number') return Number.isFinite(val) ? Math.max(0, Math.round(val)) : 0;
    const digits = String(val ?? '').replace(/[^\d]/g, '');
    const num = parseInt(digits, 10);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }

  function formatMoney(amount, currencySuffix = 'دج') {
    const num = sanitizeNumericPrice(amount);
    const formatted = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return currencySuffix ? `${formatted} ${currencySuffix}` : formatted;
  }

  async function getTopupAmountsList({ forceRefresh = false } = {}) {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('key, value')
        .like('key', 'topup_amount_%');

      if (!error && Array.isArray(data) && data.length > 0) {
        return data
          .map(row => {
            const match = String(row.key || '').match(/^topup_amount_(\d+)$/i);
            const orderNum = match ? Number(match[1]) : 9999;
            const rawValue = String(row.value ?? '').trim();
            const numericAmount = sanitizeNumericPrice(rawValue);
            const buttonText = /^\d+(?:[.,]\d+)?$/.test(rawValue) ? `${rawValue} دج` : rawValue;
            return {
              key: row.key,
              orderNum,
              rawValue,
              numericAmount,
              buttonText
            };
          })
          .filter(item => item.numericAmount > 0 && item.buttonText.length > 0)
          .sort((a, b) => a.orderNum - b.orderNum);
      }
    } catch (err) {
      console.error('getTopupAmountsList error:', err.message);
    }

    return [
      { key: 'topup_amount_1', orderNum: 1, rawValue: '1000', numericAmount: 1000, buttonText: '1000 دج' },
      { key: 'topup_amount_2', orderNum: 2, rawValue: '2000', numericAmount: 2000, buttonText: '2000 دج' },
      { key: 'topup_amount_3', orderNum: 3, rawValue: '5000', numericAmount: 5000, buttonText: '5000 دج' }
    ];
  }

  async function getDynamicTopupAmountButtons(perRow = 3, { forceRefresh = false } = {}) {
    const list = await getTopupAmountsList({ forceRefresh });
    const labels = list.map(item => item.buttonText);
    return chunkButtons(labels.length ? labels : ['1000 دج', '2000 دج', '5000 دج'], perRow);
  }

  // -----------------------------------------------------------------------
  // 🗓️ تنسيق النصوص والتواريخ والوسائط
  // -----------------------------------------------------------------------
  function escapeHtml(str = '') {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDateTime(dateInput, locale = 'ar-DZ') {
    if (!dateInput) return '';
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(d.getTime())) return String(dateInput);
    try {
      return d.toLocaleString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (_) {
      return d.toISOString().replace('T', ' ').slice(0, 16);
    }
  }

  function fitTelegramText(text = '', isCaption = false) {
    const limit = isCaption ? 1020 : 4090;
    const str = String(text ?? '');
    if (str.length <= limit) return str;
    return `${str.slice(0, limit - 2)}…`;
  }

  function normalizeMediaRef(ref) {
    if (!ref) return null;
    const clean = String(ref).trim();
    if (!clean || clean === 'EMPTY' || clean === 'FREE_NO_RECEIPT' || clean === 'null' || clean === 'undefined') {
      return null;
    }
    if (clean.startsWith('tg:')) {
      return clean.slice(3).trim() || null;
    }
    return clean;
  }

  function parseMediaListFromField(fieldVal) {
    if (!fieldVal) return [];
    if (Array.isArray(fieldVal)) {
      return fieldVal.map(normalizeMediaRef).filter(Boolean);
    }
    return String(fieldVal)
      .split('|')
      .map(normalizeMediaRef)
      .filter(Boolean);
  }

  function parseImagesFromImageUrl(imageUrlField) {
    return parseMediaListFromField(imageUrlField).slice(0, MAX_PROPERTY_IMAGES);
  }

  function buildOrderedBrowsingMedia(record = {}) {
    const out = [];
    const photos = parseImagesFromImageUrl(record.image_url);
    for (const p of photos) {
      out.push({ type: 'photo', ref: p });
    }
    const videos = parseMediaListFromField(record.video_url);
    for (const v of videos) {
      out.push({ type: 'video', ref: v });
    }
    return out;
  }

  // -----------------------------------------------------------------------
  // 👤 خدمات المستخدم والرصيد والنقاط والشحن والاستعلامات
  // -----------------------------------------------------------------------
  async function getUserRecord(userId) {
    if (!userId) return null;
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', Number(userId))
        .maybeSingle();

      if (error) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  async function isUserVerified(userId) {
    const user = await getUserRecord(userId);
    return Boolean(user && user.phone_number);
  }

  async function addUserPoints(userId, deltaPoints) {
    const user = await getUserRecord(userId);
    if (!user) return null;
    const current = Number(user.points || 0);
    const nextPoints = Math.max(0, current + Number(deltaPoints || 0));
    const { data, error } = await supabase
      .from('users')
      .update({ points: nextPoints })
      .eq('id', Number(userId))
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async function addUserWalletBalance(userId, deltaAmount) {
    const user = await getUserRecord(userId);
    if (!user) return null;
    const current = sanitizeNumericPrice(user.wallet_balance || 0);
    const nextBalance = Math.max(0, current + sanitizeNumericPrice(deltaAmount));
    const { data, error } = await supabase
      .from('users')
      .update({ wallet_balance: nextBalance })
      .eq('id', Number(userId))
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async function uploadBufferToStorage(buffer, fileName, contentType = 'image/jpeg') {
    const { error } = await supabase.storage
      .from('test_media')
      .upload(fileName, buffer, { contentType, upsert: true });

    if (error) throw error;
    const { data: pubUrl } = supabase.storage.from('test_media').getPublicUrl(fileName);
    return pubUrl?.publicUrl || null;
  }

  async function notifyAdminsHtml(botOrTelegram, htmlText, extra = {}) {
    const telegram = botOrTelegram?.telegram || botOrTelegram;
    if (!telegram) return;
    const adminIds = await getAdminIds();
    for (const adminId of adminIds) {
      await telegram.sendMessage(adminId, fitTelegramText(htmlText, false), {
        parse_mode: 'HTML',
        ...extra
      }).catch(() => {});
    }
  }

  return {
    // Settings & Dynamic Topup Buttons
    getSetting,
    getTextSetting,
    setSetting,
    getAllSettings,
    clearSettingsCache,
    replacePlaceholders,
    getTopupAmountsList,
    getDynamicTopupAmountButtons,

    // Formatting & Media Helpers
    chunkButtons,
    sanitizeNumericPrice,
    formatMoney,
    formatDateTime,
    escapeHtml,
    fitTelegramText,
    normalizeMediaRef,
    parseMediaListFromField,
    parseImagesFromImageUrl,
    buildOrderedBrowsingMedia,

    // User, Wallet, Points & Storage Services
    getUserRecord,
    isUserVerified,
    addUserPoints,
    addUserWalletBalance,
    uploadBufferToStorage,
    notifyAdminsHtml,
    Markup
  };
};
