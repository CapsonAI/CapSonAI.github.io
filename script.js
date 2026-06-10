let subtitlesData = [];
let isDragging = false;
let startX, startY, initialLeft, initialTop;
let currentVideoFile = null;

document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const videoInput = document.getElementById('video-input');
    const uploadContainer = document.getElementById('upload-container');
    const playerContainer = document.getElementById('player-container');
    const videoPreview = document.getElementById('video-preview');
    const captionOverlay = document.getElementById('caption-overlay');
    const captionSizeInput = document.getElementById('caption-size');
    const sizeVal = document.getElementById('size-val');
    const captionColorInput = document.getElementById('caption-color');
    const captionBgInput = document.getElementById('caption-bg');
    const videoFormatSelect = document.getElementById('video-format');
    const aiTriggerZone = document.getElementById('ai-trigger-zone');
    const startTranscriptionBtn = document.getElementById('start-transcription-btn');
    const statusPanel = document.getElementById('status-panel');
    const statusText = document.getElementById('status-text');
    const statusBar = document.getElementById('status-bar');
    const statusPercentage = document.getElementById('status-percentage');
    const transcriptList = document.getElementById('transcript-list');
    const downloadSrtBtn = document.getElementById('download-srt');

    if (themeToggle) {
        themeToggle.addEventListener('click', (e) => {
            e.preventDefault();
            const isDark = document.documentElement.classList.toggle('dark');
            document.body.classList.toggle('dark', isDark);
        });
    }

    if (videoFormatSelect && playerContainer) {
        videoFormatSelect.addEventListener('change', (e) => {
            const format = e.target.value;
            if (format === 'shorts') {
                playerContainer.classList.remove('normal-mode');
                playerContainer.classList.add('shorts-mode');
            } else {
                playerContainer.classList.remove('shorts-mode');
                playerContainer.classList.add('normal-mode');
            }
            
            if (subtitlesData.length > 0) {
                renderTranscriptInterface(subtitlesData);
            }
            updateActiveCaptionDisplay();

            captionOverlay.style.left = '50%';
            captionOverlay.style.top = 'auto';
            captionOverlay.style.bottom = '2.5rem';
            captionOverlay.style.transform = 'translateX(-50%)';
        });
    }

    function formatCaptionTextForLayout(text) {
        if (!text) return "";
        const isShortsMode = videoFormatSelect ? (videoFormatSelect.value === 'shorts') : false;
        
        if (!isShortsMode) {
            return text.replace(/\n/g, ' ');
        }

        const cleanWords = text.replace(/\n/g, ' ').split(/\s+/).filter(w => w.length > 0);
        let builtLines = [];
        
        for (let i = 0; i < cleanWords.length; i += 3) {
            builtLines.push(cleanWords.slice(i, i + 3).join(' '));
        }
        
        return builtLines.join('\n');
    }

    if (videoInput) {
        videoInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                currentVideoFile = file;
                const fileURL = URL.createObjectURL(file);
                
                videoPreview.src = fileURL;
                videoPreview.load(); 
                
                if (uploadContainer) uploadContainer.style.display = 'none';
                if (playerContainer) playerContainer.style.display = 'flex';
                if (aiTriggerZone) aiTriggerZone.style.display = 'block';
                
                transcriptList.innerHTML = `<p style="grid-column: 1/-1; padding: 1rem 0; text-align: center;">Click "Generate Captions with AI" to begin processing.</p>`;
            }
        });
    }

    if (captionOverlay) {
        captionOverlay.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = captionOverlay.offsetLeft;
            initialTop = captionOverlay.offsetTop;
            captionOverlay.style.bottom = 'auto'; 
            captionOverlay.style.transform = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            let newLeft = initialLeft + deltaX;
            let newTop = initialTop + deltaY;

            const parent = playerContainer;
            if (newLeft < 0) newLeft = 0;
            if (newTop < 0) newTop = 0;
            if (newLeft + captionOverlay.offsetWidth > parent.offsetWidth) {
                newLeft = parent.offsetWidth - captionOverlay.offsetWidth;
            }
            if (newTop + captionOverlay.offsetHeight > parent.offsetHeight) {
                newTop = parent.offsetHeight - captionOverlay.offsetHeight;
            }

            captionOverlay.style.left = `${newLeft}px`;
            captionOverlay.style.top = `${newTop}px`;
        });

        document.addEventListener('mouseup', () => isDragging = false);
    }

    if (captionSizeInput) {
        captionSizeInput.addEventListener('input', (e) => {
            const size = e.target.value;
            if (sizeVal) sizeVal.textContent = `${size}px`;
            captionOverlay.style.fontSize = `${size}px`;
        });
    }

    if (captionColorInput) {
        captionColorInput.addEventListener('input', (e) => {
            captionOverlay.style.color = e.target.value;
        });
    }

    if (captionBgInput) {
        captionBgInput.addEventListener('input', (e) => {
            captionOverlay.style.backgroundColor = e.target.value + '99'; 
        });
    }

    async function extractAudioBuffer(file) {
        const tempAudio = document.createElement('audio');
        tempAudio.src = URL.createObjectURL(file);
        
        await new Promise((resolve) => {
            tempAudio.onloadedmetadata = () => resolve();
        });
        
        const exactDuration = tempAudio.duration;
        const targetSampleRate = 16000;
        const totalTargetSamples = Math.ceil(exactDuration * targetSampleRate);

        const baseAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const fileBuffer = await file.arrayBuffer();
        const decodedBuffer = await baseAudioCtx.decodeAudioData(fileBuffer);
        
        const offlineCtx = new OfflineAudioContext(1, totalTargetSamples, targetSampleRate);
        const bufferSource = offlineCtx.createBufferSource();
        bufferSource.buffer = decodedBuffer;
        bufferSource.connect(offlineCtx.destination);
        bufferSource.start();
        
        const finalRenderedBuffer = await offlineCtx.startRendering();
        baseAudioCtx.close(); 

        return finalRenderedBuffer.getChannelData(0);
    }

    function processEnvironmentalAudio(text) {
        let cleanText = text.trim();
        if (!cleanText || cleanText.length < 2) return null;

        const musicPatterns = [/music/i, /bgm/i, /instrumental/i, /singing/i, /♪/i, /\[music\]/i];
        const noisePatterns = [/background noise/i, /static/i, /shuffling/i, /rustling/i, /silence/i, /uh/i, /um/i];

        if (musicPatterns.some(pattern => pattern.test(cleanText)) && cleanText.split(" ").length <= 3) {
            return "[Music]";
        }
        if (noisePatterns.some(pattern => pattern.test(cleanText)) && cleanText.split(" ").length <= 3) {
            return "[Background Noise]";
        }

        const mcDictionary = [
            { wrong: /\b(competitors|competitor|comp্যারator|comparetor)\b/gi, right: "comparator" },
            { wrong: /\b(server|observers|observation block|observe her)\b/gi, right: "observer" },
            { wrong: /\b(stripper|droppers|driver)\b/gi, right: "dropper" },
            { wrong: /\b(his upper|hopes|upper|hop her)\b/gi, right: "hopper" },
            { wrong: /\b(shoker|shaker|shoulder|shulker|shulk|sheller) box\b/gi, right: "Shulker Box" },
            { wrong: /\b(shoker box letter|shulker loader|shulker input)\b/gi, right: "Shulker Box loader" },
            { wrong: /\b(shokers|shoulders|shakers)\b/gi, right: "Shulkers" },
            { wrong: /\b(sticking piston|sticky business|stick piston)\b/gi, right: "sticky piston" },
            { wrong: /\b(piston fee limit|piston feed limit|feed limits)\b/gi, right: "piston push limit" },
            { wrong: /\b(bud switch|blood switch|butt switch)\b/gi, right: "BUD switch" },
            { wrong: /\b(t flip-flop|t-flop|tea flip)\b/gi, right: "T flip-flop" },
            { wrong: /\b(monostable circuit|monostable multi-vibrator)\b/gi, right: "monostable circuit" },
            { wrong: /\b(pulse extender|pulse extender circuit)\b/gi, right: "pulse extender" },
            { wrong: /\b(falling edge|fall edge detector)\b/gi, right: "falling-edge detector" },
            { wrong: /\b(rising edge detector)\b/gi, right: "rising-edge detector" },
            { wrong: /\b(redstone dusts|redstone wire line)\b/gi, right: "redstone dust" },
            { wrong: /\b(repeater lock|locking repeaters)\b/gi, right: "repeater locking" },
            { wrong: /\b(wireless redstone|skulk sensor wireless)\b/gi, right: "Sculk wireless" },
            { wrong: /\b(shielding|shielding of 15|signal 15|single 15)\b/gi, right: "signal of 15" },
            { wrong: /\b(powered level 14|power 14|powered 14)\b/gi, right: "power level 14" },
            { wrong: /\b(strength 15|signal strength 15)\b/gi, right: "signal strength 15" },
            { wrong: /\b(observer clock|observer loop|redstone clock ticking)\b/gi, right: "observer clock" },
            { wrong: /\b(hopper clock|etho clock|etho hopper loop)\b/gi, right: "Etho hopper clock" },
            { wrong: /\b(instant wire|zero tick line|instant repeater)\b/gi, right: "zero-tick wire" },
            { wrong: /\b(item filter system|sorting system logic)\b/gi, right: "multi-item sorter" },
            { wrong: /\b(quasi connectivity|quasi-connectivity logic|qc bug)\b/gi, right: "quasi-connectivity" },
            { wrong: /\b(hobby|obby|obsidian casing)\b/gi, right: "obby" },
            { wrong: /\b(crying hobby|crying obsidian block)\b/gi, right: "crying obby" },
            { wrong: /\b(target block processing)\b/gi, right: "target block" },
            { wrong: /\b(light-weighted pressure plate|gold plate)\b/gi, right: "weighted pressure plate" },
            { wrong: /\b(nbt tags|nbt data structures|item data tags)\b/gi, right: "NBT tags" },
            { wrong: /\b(block state properties|blockstates)\b/gi, right: "block states" },
            { wrong: /\b(tile entity data|block entities)\b/gi, right: "block entity" },
            { wrong: /\b(skelly|skellies|bone archer)\b/gi, right: "skelly" },
            { wrong: /\b(wither skelly|wither skeleton head)\b/gi, right: "wither skelly" },
            { wrong: /\b(piglin bartering loop|piglin trades)\b/gi, right: "piglin bartering" },
            { wrong: /\b(enderman farm logic|xp enderman)\b/gi, right: "enderman farm" },
            { wrong: /\b(iron golem spawning mechanics)\b/gi, right: "golem mechanics" },
            { wrong: /\b(zombie pigman tracking|aggro mechanics)\b/gi, right: "pigman aggro" },
            { wrong: /\b(blaze rod processing farm)\b/gi, right: "blaze farm" },
            { wrong: /\b(ender dragon boss fight)\b/gi, right: "Ender Dragon" },
            { wrong: /\b(iron farm processing|golem farm layout)\b/gi, right: "iron farm" },
            { wrong: /\b(raid farm processing|stacking raid loop)\b/gi, right: "stacking raid farm" },
            { wrong: /\b(witch hut ticking farm|perimeter witch)\b/gi, right: "witch farm" },
            { wrong: /\b(slime farm chunk parsing)\b/gi, right: "slime chunk farm" },
            { wrong: /\b(creeper farm firing|gunpowder grid)\b/gi, right: "creeper farm" },
            { wrong: /\b(gold farm netting|nether roof portal processing)\b/gi, right: "gold farm" },
            { wrong: /\b(wood tree farm automatic|tnt duper farm)\b/gi, right: "universal tree farm" },
            { wrong: /\b(spawn chunks parameters|always loaded chunks)\b/gi, right: "spawn chunks" },
            { wrong: /\b(lazy chunks logic|non-entity chunks)\b/gi, right: "lazy chunks" },
            { wrong: /\b(chunk loaders|portal loaders tracking)\b/gi, right: "chunk loader" },
            { wrong: /\b(random tick speed rates|gamerule randomtick)\b/gi, right: "random tick speed" },
            { wrong: /\b(server tps drops|ticks per second metric)\b/gi, right: "TPS drops" },
            { wrong: /\b(mspt engine lagging|milliseconds per tick)\b/gi, right: "MSPT lag" },
            { wrong: /\b(tick skip processing|tick freeze tracking)\b/gi, right: "tick warping" },
            { wrong: /\b(sub-chunk updates|render engine distances)\b/gi, right: "sub-chunks" },
            { wrong: /\b(w-tap tracking|w tap sprint combo)\b/gi, right: "W-tapping" },
            { wrong: /\b(s-tap defensive tracking|s tap distance control)\b/gi, right: "S-tapping" },
            { wrong: /\b(block clutching save|clutching off walls)\b/gi, right: "block clutching" },
            { wrong: /\b(hit boxes tracking|entity hitbox visual)\b/gi, right: "hitboxes" },
            { wrong: /\b(cps counter clicking|clicks per second velocity)\b/gi, right: "CPS speed" },
            { wrong: /\b(strafe combos parsing|strafing circles around)\b/gi, right: "strafing combos" },
            { wrong: /\b(rod tricking combo|fishing rod knockback hook)\b/gi, right: "rod tricking" },
            { wrong: /\b(crit jumping attacks|critical strike jump timing)\b/gi, right: "crit sweeping" },
            { wrong: /\b(lava placing wrap|lava tracking bucket wrap)\b/gi, right: "lava wrapping" },
            { wrong: /\b(potting speeds healing|splash potion delay)\b/gi, right: "fast potting" },
            { wrong: /\b(griefers protection tracking|griefing logic claim)\b/gi, right: "griefer protection" },
            { wrong: /\b(prison server setups|op prison grinding rank)\b/gi, right: "prison server" },
            { wrong: /\b(donut smp configurations|spawn trap claims)\b/gi, right: "Donut SMP" },
            { wrong: /\b(lifesteal tracking custom hearts plugin)\b/gi, right: "LifeSteal SMP" },
            { wrong: /\b(factions claims mapping|tnt cannoning systems)\b/gi, right: "factions base raiding" },
            { wrong: /\b(world guard claims system|worldedit processing)\b/gi, right: "WorldGuard regions" },
            { wrong: /\b(coreprotect rollback analysis|logblock check block)\b/gi, right: "CoreProtect logs" }
        ];

        mcDictionary.forEach(term => {
            cleanText = cleanText.replace(term.wrong, term.right);
        });

        return cleanText;
    }

    function bufferToWav(buffer, sampleRate) {
        const bufferLength = buffer.length;
        const wavArray = new Uint8Array(44 + bufferLength * 2);
        const view = new DataView(wavArray.buffer);

        view.setUint32(0, 0x52494646, false); // "RIFF"
        view.setUint32(4, 36 + bufferLength * 2, true);
        view.setUint32(8, 0x57415645, false); // "WAVE"
        view.setUint32(12, 0x666d7420, false); // "fmt "
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        view.setUint32(36, 0x64617461, false); // "data"
        view.setUint32(40, bufferLength * 2, true);

        let offset = 44;
        for (let i = 0; i < bufferLength; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, buffer[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return new Blob([wavArray], { type: 'audio/wav' });
    }

    if (startTranscriptionBtn) {
        startTranscriptionBtn.addEventListener('click', async () => {
            if (!currentVideoFile) return alert("Please upload a video file first.");
            
            if (aiTriggerZone) aiTriggerZone.style.display = 'none';
            if (statusPanel) statusPanel.style.display = 'block';
            if (statusBar) statusBar.style.width = '10%';
            if (statusPercentage) statusPercentage.textContent = '10%';

            try {
                if (statusText) statusText.textContent = "Extracting audio track layers...";
                const rawAudioData = await extractAudioBuffer(currentVideoFile);
                
                const sampleRate = 16000;
                const paddingSamples = 5 * sampleRate;
                const audioData = new Float32Array(rawAudioData.length + paddingSamples);
                audioData.set(rawAudioData); 

                const chunkDurationSeconds = 45; 
                const chunkSize = chunkDurationSeconds * sampleRate;
                const totalChunks = Math.ceil(audioData.length / chunkSize);
                
                if (statusText) statusText.textContent = `Preparing segments (0/${totalChunks})...`;

                let chunksCompleted = 0;

                // Fire all HTTP requests concurrently to maximize throughput speed
                const chunkPromises = Array.from({ length: totalChunks }).map(async (_, chunkIndex) => {
                    const startSample = chunkIndex * chunkSize;
                    const endSample = Math.min(startSample + chunkSize, audioData.length);
                    
                    if (startSample >= audioData.length) return [];

                    const chunkData = audioData.slice(startSample, endSample);
                    const wavBlob = bufferToWav(chunkData, sampleRate);
                    const offsetSeconds = startSample / sampleRate;

                    const response = await fetch('https://capsonai.qualiwar.workers.dev', {
                        method: 'POST',
                        body: wavBlob,
                        headers: {
                            'Content-Type': 'application/octet-stream'
                        }
                    });

                    if (!response.ok) {
                        const errData = await response.json().catch(() => ({}));
                        throw new Error(errData.error || `Edge execution failed on chunk ${chunkIndex + 1}.`);
                    }

                    const data = await response.json();

                    // Update metrics as chunks resolve non-sequentially
                    chunksCompleted++;
                    const progress = 10 + Math.floor((chunksCompleted / totalChunks) * 80);
                    if (statusBar) statusBar.style.width = `${progress}%`;
                    if (statusPercentage) statusPercentage.textContent = `${progress}%`;
                    if (statusText) statusText.textContent = `Processing chunks (${chunksCompleted}/${totalChunks})...`;

                    if (data.segments && data.segments.length > 0) {
                        return data.segments.map(seg => {
                            const cleanWordsText = processEnvironmentalAudio(seg.text);
                            return {
                                start: seg.start + offsetSeconds,
                                end: seg.end + offsetSeconds,
                                text: cleanWordsText ? cleanWordsText : seg.text.trim()
                            };
                        }).filter(item => item.text !== null);
                    } else if (data.text && data.text.trim().length > 0) {
                        const chunkDuration = (endSample - startSample) / sampleRate;
                        return [{ 
                            start: offsetSeconds, 
                            end: offsetSeconds + chunkDuration, 
                            text: processEnvironmentalAudio(data.text) || data.text 
                        }];
                    }
                    return [];
                });

                // Wait for all async tasks to execute and merge everything
                const results = await Promise.all(chunkPromises);
                let allSubtitles = results.flat();

                if (statusText) statusText.textContent = "Analyzing timelines with text layers...";
                if (statusBar) statusBar.style.width = '100%';
                if (statusPercentage) statusPercentage.textContent = '100%';

                // Sort chronologically and filter out AI silence hallucinations 
                const actualVideoDuration = videoPreview.duration;
                subtitlesData = allSubtitles
                    .sort((a, b) => a.start - b.start)
                    .filter(sub => sub.start <= actualVideoDuration);

                if (statusPanel) statusPanel.style.display = 'none';
                
                if (subtitlesData.length === 0) {
                    transcriptList.innerHTML = `<p style="padding: 1rem 0; text-align: center;">No voice tracks identified.</p>`;
                } else {
                    renderTranscriptInterface(subtitlesData);
                    bindVideoTimelineSync();
                    if (downloadSrtBtn) downloadSrtBtn.disabled = false;
                }

            } catch (err) {
                if (statusText) statusText.textContent = "Processing allocation failure.";
                console.error(err);
                alert(`Cloud Processing Error: ${err.message}`);
                if (aiTriggerZone) aiTriggerZone.style.display = 'block';
                if (statusPanel) statusPanel.style.display = 'none';
            }
        });
    }

    function renderTranscriptInterface(data) {
        const scrollWrapper = document.querySelector('.transcript-scroll-wrapper');
        if (scrollWrapper) {
            scrollWrapper.classList.remove('transcript-placeholder');
            scrollWrapper.classList.add('transcript-list-active');
        }

        transcriptList.innerHTML = '';
        data.forEach((item, index) => {
            const formattedRowText = formatCaptionTextForLayout(item.text);
            const lineCount = formattedRowText.split('\n').length;
            
            const row = document.createElement('div');
            row.className = "transcript-row";
            row.innerHTML = `
                <div class="time-stamp">${formatTime(item.start)} --> ${formatTime(item.end)}</div>
                <textarea data-index="${index}" class="transcript-edit-input" rows="${lineCount}">${formattedRowText}</textarea>
            `;
            transcriptList.appendChild(row);
        });

        document.querySelectorAll('.transcript-edit-input').forEach(textarea => {
            const adjustHeight = () => {
                textarea.style.height = 'auto';
                textarea.style.height = `${textarea.scrollHeight}px`;
            };
            
            adjustHeight(); 

            textarea.addEventListener('input', (e) => {
                const idx = e.target.getAttribute('data-index');
                subtitlesData[idx].text = e.target.value.replace(/\n/g, ' ');
                adjustHeight();
                updateActiveCaptionDisplay();
            });
        });
    }

    function updateActiveCaptionDisplay() {
        if (!videoPreview || subtitlesData.length === 0) return;
        const currentTime = videoPreview.currentTime;
        const activeSubtitle = subtitlesData.find(s => currentTime >= s.start && currentTime <= s.end);
        
        if (activeSubtitle) {
            captionOverlay.textContent = formatCaptionTextForLayout(activeSubtitle.text);
            captionOverlay.style.opacity = '1';
        } else {
            captionOverlay.style.opacity = '0';
        }
    }

    function bindVideoTimelineSync() {
        videoPreview.addEventListener('timeupdate', updateActiveCaptionDisplay);
    }

    if (downloadSrtBtn) {
        downloadSrtBtn.addEventListener('click', () => {
            let srtContent = '';
            subtitlesData.forEach((item, i) => {
                srtContent += `${i + 1}\n`;
                srtContent += `${formatSRTTime(item.start)} --> ${formatSRTTime(item.end)}\n`;
                srtContent += `${formatCaptionTextForLayout(item.text)}\n\n`;
            });

            const blob = new Blob([srtContent], { type: 'text/srt;charset=utf-8;' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'captions.srt';
            link.click();
        });
    }

    function formatTime(seconds) {
        if (isNaN(seconds) || seconds === null) return "00:00";
        const m = Math.floor(seconds / 60).toString().padStart(2, '0');
        const s = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    function formatSRTTime(seconds) {
        if (isNaN(seconds) || seconds === null) seconds = 0;
        const date = new Date(null);
        date.setSeconds(seconds);
        const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
        const timeString = date.toISOString().substr(11, 8);
        return `${timeString},${ms}`;
    }
});