'use strict';

// =========================================================================
// ⚙️ SERVICE LAYER — دوال الخدمات والإعدادات الديناميكية وقواعد البيانات
// =========================================================================

module.exports = function createServices(core) {
  const {
    supabase,
    Markup,
    chunkButtons,
    sanitizeNumericPrice,
    formatMoney
  } = core;

  let settingsCache = {};
  let settingsCacheAt = 0;
  const SETTINGS_TTL_MS = 30 * 1000;

  async function loadAllSettings({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && Object.keys(settingsCache).length > 0 && now - settingsCacheAt < SETTINGS_TTL_MS) {
      return settingsCache;
    }

    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('key, value');

      if (!error && Array.isArray(data)) {
        const nextMap = {};
        for (const row of data) {
          if (row && row.key) {
            nextMap[row.key] = row.value ?? '';
          }
        }
        settingsCache = nextMap;
        settingsCacheAt = now;
        return settingsCache;
      }
    } catch (err) {
      console.error('loadAllSettings error:', err.message);
    }

    return settingsCache;
  }

  async function getDynamicSetting(key, fallback = '', { forceRefresh = false } = {}) {
    const all = await loadAllSettings({ forceRefresh });
    if (Object.prototype.hasOwnProperty.call(all, key) && all[key] !== null && all[key] !== undefined && String(all[key]).trim() !== '') {
      return String(all[key]);
    }
    return fallback;
  }

  // جلب جميع مفاتيح المبالغ topup_amount_* من app_settings مرتبة حسب الرقم بدون حد ضيق
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

  // تقسيم أزرار المبالغ على صفوف (3 أزرار في كل صف لاستيعاب عدد كبير بوضوح)
  async function getDynamicTopupAmountButtons(perRow = 3, { forceRefresh = false } = {}) {
    const list = await getTopupAmountsList({ forceRefresh });
    const labels = list.map(item => item.buttonText);
    return chunkButtons(labels.length ? labels : ['1000 دج', '2000 دج', '5000 دج'], perRow);
  }

  async function getTopupKeyboard(perRow = 3, { forceRefresh = false } = {}) {
    const rows = await getDynamicTopupAmountButtons(perRow, { forceRefresh });
    return Markup.keyboard([
      ...rows,
      ['⬅️ رجوع', '🏠 القائمة الرئيسية']
    ]).resize();
  }

  async function formatTopupAmountSummary(amount) {
    const clean = sanitizeNumericPrice(amount);
    return formatMoney(clean);
  }

  return {
    loadAllSettings,
    getDynamicSetting,
    getTopupAmountsList,
    getDynamicTopupAmountButtons,
    getTopupKeyboard,
    formatTopupAmountSummary
  };
};
