const text = `
Вы наклоняетесь и сгребаете мочу.
"dialogue-speech">«Фу, воняет хуже свиньи!» — ржет мясник.
Толпа хохочет.
`;

function format(processed) {
    // 1. Clean entities (mock)
    processed = processed.replace(/&quot;/g, '"');

    // 2. Regex from server.js
    const oldRegex = /["'„“]?dialogue-speech["'”]?\s*>\s*([«"“][^]+?[»"”])/gi;

    // Test match
    const match = text.match(oldRegex);
    console.log("Match found:", match);

    processed = processed.replace(oldRegex, '<span class="dialogue-speech"><i>$1</i></span>');
    return processed;
}

console.log("Original:", text);
console.log("Formatted:", format(text));
