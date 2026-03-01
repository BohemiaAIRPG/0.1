const fs = require('fs');
fetch('http://127.0.0.1:7860/sdapi/v1/options')
    .then(res => res.json())
    .then(data => {
        const keysToLog = {};
        for (const k in data) {
            const kl = k.toLowerCase();
            if (kl.includes('forge') || kl.includes('gpu') || kl.includes('weight') || kl.includes('mem')) {
                keysToLog[k] = data[k];
            }
        }
        fs.writeFileSync('gpu_opts_node.json', JSON.stringify(keysToLog, null, 2));
        console.log('Saved to gpu_opts_node.json');
    })
    .catch(err => console.error(err));
