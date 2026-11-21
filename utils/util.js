// 通用小工具：时间格式化、提示、防抖
function pad(n) {
    return n < 10 ? '0' + n : '' + n;
}

function parseTime(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    // iOS 不支持 "2026-01-01 12:00:00" 这种带空格的格式
    const text = String(value).replace(' ', 'T');
    const date = new Date(text);
    return isNaN(date.getTime()) ? null : date;
}

function formatRelative(value) {
    const date = parseTime(value);
    if (!date) return '';
    const diff = Date.now() - date.getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (diff < minute) return '刚刚';
    if (diff < hour) return Math.floor(diff / minute) + ' 分钟前';
    if (diff < day) return Math.floor(diff / hour) + ' 小时前';
    if (diff < 7 * day) return Math.floor(diff / day) + ' 天前';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function formatCount(value) {
    const num = Number(value) || 0;
    if (num >= 10000) return (num / 10000).toFixed(1).replace('.0', '') + 'w';
    if (num >= 1000) return (num / 1000).toFixed(1).replace('.0', '') + 'k';
    return String(num);
}

function toast(title) {
    wx.showToast({ title: title || '', icon: 'none', duration: 1800 });
}

function confirm(content, title) {
    return new Promise((resolve) => {
        wx.showModal({
            title: title || '提示',
            content: content,
            confirmColor: '#FF6B35',
            success: (res) => resolve(!!res.confirm),
            fail: () => resolve(false),
        });
    });
}

function unique(arr) {    const seen = {};
    const out = [];
    (arr || []).forEach((item) => {
        if (!item || seen[item]) return;
        seen[item] = true;
        out.push(item);
    });
    return out;
}

/* 头像取首字，避免长昵称挤爆圆形头像 */
function initial(name, fallback) {
    const text = String(name || '').trim();
    return text ? text.slice(0, 1) : fallback || '食';
}

module.exports = { formatRelative, formatCount, toast, confirm, unique, initial };
