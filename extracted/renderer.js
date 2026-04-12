const { ipcRenderer } = require('electron');

let timerInterval;
let totalSeconds = 0;
let remainingSeconds = 0;
let isRunning = false;
let isOvertime = false;
let volume = 0.5;

const display = document.getElementById('timer-display');
const container = document.getElementById('timer-container');

const customTimeModal = document.getElementById('custom-time-modal');
const customTimeInput = document.getElementById('custom-time-input');
const customTimeOk = document.getElementById('custom-time-ok');
const customTimeCancel = document.getElementById('custom-time-cancel');

// Sound Context
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playDing() {
    try {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.5);
        
        gainNode.gain.setValueAtTime(volume, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.5);
    } catch (e) {
        console.error("Audio playback failed", e);
    }
}

function updateDisplay() {
    let seconds = Math.abs(remainingSeconds);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const formatted = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    
    if (isOvertime) {
        display.innerText = `+${formatted}`;
        display.className = 'color-red';
    } else {
        display.innerText = formatted;
        
        if (remainingSeconds <= 60) {
            display.className = 'color-red';
        } else if (remainingSeconds <= totalSeconds / 2) {
            display.className = 'color-yellow';
        } else {
            display.className = 'color-green';
        }
    }
}

function tick() {
    if (isOvertime) {
        remainingSeconds++;
    } else {
        remainingSeconds--;
    }

    if (!isOvertime && remainingSeconds === 60) {
        playDing();
    }

    if (!isOvertime && remainingSeconds < 0) {
        remainingSeconds = 0;
        pauseTimer();
        // Show alert window in screen center
        ipcRenderer.send('show-alert-window');
        return;
    }
    
    updateDisplay();
}

function startTimer() {
    if (isRunning) return;
    isRunning = true;
    timerInterval = setInterval(tick, 1000);
}

function pauseTimer() {
    isRunning = false;
    clearInterval(timerInterval);
}

function stopTimer() {
    pauseTimer();
}

function resetTimer(newTimeSeconds) {
    pauseTimer();
    isOvertime = false;
    if (newTimeSeconds !== undefined) {
        totalSeconds = newTimeSeconds;
    }
    remainingSeconds = totalSeconds;
    updateDisplay();
    if (totalSeconds <= 60) display.className = 'color-red';
    else display.className = 'color-green';
}

function toggleTimer() {
    if (isRunning) pauseTimer();
    else startTimer();
}

// Alert window closed - start overtime counting
ipcRenderer.on('alert-closed', () => {
    isOvertime = true;
    remainingSeconds = 0;
    startTimer();
});

// IPC Listeners
ipcRenderer.on('timer-toggle', toggleTimer);
ipcRenderer.on('timer-start', startTimer);
ipcRenderer.on('timer-pause', pauseTimer);
ipcRenderer.on('timer-reset', () => resetTimer());

ipcRenderer.on('timer-set', (event, minutes) => {
    resetTimer(minutes * 60);
    startTimer();
});

ipcRenderer.on('timer-set-fontsize', (event, size) => {
    display.style.fontSize = `${size}px`;
});

ipcRenderer.on('timer-set-volume', (event, vol) => {
    volume = vol;
    playDing();
});

ipcRenderer.on('timer-set-opacity', (event, opacity) => {
    display.style.opacity = opacity;
});

// Custom Time Modal Logic
let isModalOpen = false;

ipcRenderer.on('show-custom-time-input', () => {
    isModalOpen = true;
    customTimeModal.classList.remove('hidden');
    customTimeModal.style.display = 'flex';
    customTimeInput.value = '';
    customTimeInput.focus();
    isDragging = false;
    ipcRenderer.send('set-ignore-mouse-events', false);
});

function closeCustomTimeModal() {
    isModalOpen = false;
    customTimeModal.classList.add('hidden');
    customTimeModal.style.display = 'none';
    ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
}

customTimeOk.addEventListener('click', () => {
    const val = parseInt(customTimeInput.value);
    if (val && val > 0) {
        ipcRenderer.send('timer-set-custom-relay', val);
    }
    closeCustomTimeModal();
});

customTimeCancel.addEventListener('click', closeCustomTimeModal);

customTimeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') customTimeOk.click();
});

// Initial Setup
resetTimer(10 * 60);

// Context Menu Trigger
window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    ipcRenderer.send('show-context-menu');
});

// ============ Mouse Pass-through and Drag Logic ============
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

// When mouse enters the display text, enable interaction
display.addEventListener('mouseenter', () => {
    if (!isModalOpen) {
        ipcRenderer.send('set-ignore-mouse-events', false);
    }
});

// When mouse leaves the display text, enable pass-through
display.addEventListener('mouseleave', () => {
    if (!isModalOpen && !isDragging) {
        ipcRenderer.send('set-ignore-mouse-events', true, { forward: true });
    }
});

// Drag start
display.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
        isDragging = true;
        lastMouseX = e.screenX;
        lastMouseY = e.screenY;
        e.preventDefault();
    }
});

// Drag move - use delta (increment) approach for stability
document.addEventListener('mousemove', (e) => {
    if (isDragging) {
        const deltaX = e.screenX - lastMouseX;
        const deltaY = e.screenY - lastMouseY;
        lastMouseX = e.screenX;
        lastMouseY = e.screenY;
        
        if (deltaX !== 0 || deltaY !== 0) {
            ipcRenderer.send('window-move', { deltaX, deltaY });
        }
    }
});

// Drag end
document.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
    }
});

// Also listen on window for edge cases
window.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
    }
});
