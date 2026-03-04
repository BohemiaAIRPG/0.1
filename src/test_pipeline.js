import 'dotenv/config';
import * as fs from 'fs';

const COMET_API_KEY = process.env.COMET_API_KEY;
const COMET_API_BASE = 'https://api.cometapi.com/v1';
const MODEL_NAME = 'deepseek-v3.2-exp';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'nano-banana-2';

const IMAGE_HISTORY_PREFIX = `maximum photorealism, historical realism, highly detailed medieval photography, captured on high-end camera, 8k resolution, cinematic lighting, muddy cobblestone streets, Kutna Hora Bohemia 1403, silver mining town, gothic architecture, candlelight, torchlight, dark and gritty atmosphere, muted earth tones, period-accurate clothing and tools —`;

async function main() {
    console.log(`\n=== PIPELINE TEST ===`);
    console.log(`Text model: ${MODEL_NAME}`);
    console.log(`Image model: ${IMAGE_MODEL}\n`);

    // Step 1: Ask DeepSeek for a scene
    console.log(`[1/3] Sending request to ${MODEL_NAME}...`);
    const textRes = await fetch(`${COMET_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${COMET_API_KEY}`
        },
        body: JSON.stringify({
            model: MODEL_NAME,
            messages: [
                { role: 'system', content: 'You are a medieval RPG narrator set in Kutna Hora, Bohemia 1403. Respond with [NARRATIVE]...[/NARRATIVE], [IMAGE_PROMPT]...[/IMAGE_PROMPT] (English, 50-70 words, static scene), and [CHOICES]...[/CHOICES].' },
                { role: 'user', content: 'Действие игрока: "Осмотреться вокруг"' }
            ],
            temperature: 0.6,
            max_tokens: 2000
        })
    });

    if (!textRes.ok) {
        console.error(`Text API error ${textRes.status}: ${await textRes.text()}`);
        process.exit(1);
    }

    const textJson = await textRes.json();
    const aiMessage = textJson.choices[0].message.content;
    console.log(`[1/3] OK! AI response received.\n`);

    // Step 2: Parse IMAGE_PROMPT (with or without closing tag)
    const imagePromptMatch = aiMessage.match(/\[IMAGE_PROMPT\]([\s\S]*?)(?:\[\/IMAGE_PROMPT\]|\[CHOICES\]|\[SHORTCODE\]|$)/);
    if (!imagePromptMatch) {
        console.error('No [IMAGE_PROMPT] found in AI response!');
        console.log('\nFull response:\n', aiMessage);
        process.exit(1);
    }

    const imagePrompt = imagePromptMatch[1].trim();
    const fullPrompt = `${IMAGE_HISTORY_PREFIX} ${imagePrompt}`;
    console.log(`[2/3] Extracted IMAGE_PROMPT: "${imagePrompt.substring(0, 100)}..."\n`);

    // Step 3: Generate image with Gemini via CometAPI
    const geminiUrl = "https://api.cometapi.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent";
    console.log(`[3/3] Generating image with gemini-3.1-flash-image-preview...`);
    const imgRes = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
            "x-goog-api-key": COMET_API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
            generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: { aspectRatio: "16:9" }
            }
        })
    });

    if (!imgRes.ok) {
        const errText = await imgRes.text();
        console.error(`Gemini Image API error ${imgRes.status}: ${errText}`);
        process.exit(1);
    }

    const imgJson = await imgRes.json();
    const candidate = imgJson.candidates?.[0];
    const part = candidate?.content?.parts?.[0];

    if (part?.inlineData?.data) {
        const buf = Buffer.from(part.inlineData.data, 'base64');
        fs.writeFileSync('test_output.png', buf);
        console.log(`\nSUCCESS! Image saved to test_output.png (${buf.length} bytes, ${part.inlineData.mimeType})`);
    } else if (part?.text) {
        console.log('\nGemini returned text instead of image:', part.text);
    } else {
        console.log('\nUnexpected response:', JSON.stringify(imgJson).substring(0, 500));
    }
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});
