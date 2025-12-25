export function clamp(n, min, max) {
    if (typeof n !== 'number' || Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
}

export function hashStringToInt(str) {
    // FNV-1a 32-bit
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function stableIdFromName(name) {
    const s = String(name || '').trim().toLowerCase();
    if (!s) return 'loc_' + Math.random().toString(36).slice(2, 10);
    // Simple stable-ish id (not cryptographic) to keep saves readable
    return 'loc_' + s
        .replace(/ё/g, 'е')
        .replace(/[^a-z0-9а-я\s_-]/gi, '')
        .replace(/\s+/g, '_')
        .slice(0, 40);
}

export function formatDescription(text) {
    if (!text) return '';
    let processed = text;

    // 1. Декодирование (на всякий случай)
    processed = processed
        .replace(/&quot;/g, '"')
        .replace(/&laquo;/g, '«')
        .replace(/&raquo;/g, '»')
        .replace(/&gt;/g, '>')
        .replace(/&lt;/g, '<')
        .replace(/&nbsp;/g, ' ');

    // 2. Унификация: превращаем любые вариации диалогов-маркеров в [SPEECH]
    processed = processed.replace(/["']?dialogue-speech["']?>\s*/gi, '[SPEECH]');

    // 3. Форматирование [SPEECH]«...» в HTML
    const speechRegex = /\[SPEECH\]\s*([«"“][^]+?[»"”])/gi;
    processed = processed.replace(speechRegex, (match, quote) => {
        return `<span class="dialogue-speech"><i>${quote}</i></span>`;
    });

    // 4. Очистка "остатков" (если маркер есть, а кавычек нет)
    processed = processed.replace(/\[SPEECH\]/gi, '');

    return processed;
}

export function formatDate(date) {
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${date.day} ${months[date.month - 1]} ${date.year} года`;
}

export function getTurnIndex(gameState) {
    return Array.isArray(gameState.history) ? gameState.history.length : 0;
}
