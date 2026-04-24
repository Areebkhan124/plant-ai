/* ════════════════════════════════════════════════════════════════════════════
   PLANTA — app.js   Main frontend logic + FastAPI integration
════════════════════════════════════════════════════════════════════════════ */

// ─── API BASE URL (auto-detects local vs. Railway/HF) ────────────────────────
// • On localhost / 127.0.0.1  → talks to the local uvicorn server at :8000
// • On Cloud (or any other host) → backend is on the same origin (same app)
//   so we use window.location.origin instead of a hardcoded URL.

const _isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE  = _isLocal ? 'http://localhost:8000' : window.location.origin;

// ─── SESSION HISTORY ──────────────────────────────────────────
const HISTORY_KEY = 'PLANTA_history';

function getHistory() {
  try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY)) || []; }
  catch { return []; }
}

function saveHistory(entries) {
  sessionStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
}

function addHistoryEntry(disease, confidence) {
  const entries = getHistory();
  const isHealthy = disease.toLowerCase().includes('healthy');
  entries.unshift({          // newest first
    id:         Date.now(),
    disease,
    confidence,
    isHealthy,
    time:       new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  });
  saveHistory(entries);
  renderHistory();
}

function clearHistory() {
  sessionStorage.removeItem(HISTORY_KEY);
  renderHistory();
}

function renderHistory() {
  const entries   = getHistory();
  const listEl    = document.getElementById('historyList');
  const emptyEl   = document.getElementById('historyEmpty');
  const badge     = document.getElementById('historyBadge');
  const clearBtn  = document.getElementById('historyClearBtn');
  const navBtn    = document.getElementById('historyNavBtn');
  if (!listEl) return;
  
  // Badge
  if (entries.length > 0) {
    badge.textContent    = entries.length > 99 ? '99+' : entries.length;
    badge.style.display  = 'inline-flex';
    clearBtn.style.display = 'inline-flex';
    navBtn.classList.add('active');
    if (emptyEl) emptyEl.style.display = 'none';
    
    // Remove previous entry cards (keep emptyEl in DOM)
    listEl.querySelectorAll('.history-entry').forEach(el => el.remove());
    
    entries.forEach((entry, i) => {
      const card = document.createElement('div');
      card.className = 'history-entry';
      card.style.animationDelay = `${i * 40}ms`;
      card.title = 'Click to scroll to detect section';
      const typeClass = entry.isHealthy ? 'healthy' : 'diseased';
      const icon      = entry.isHealthy ? '🌿' : '🦠';
      const confClass = entry.isHealthy ? 'healthy' : 'diseased';
      card.innerHTML = `
        <div class="history-entry-icon ${typeClass}">${icon}</div>
        <div class="history-entry-body">
          <div class="history-entry-name" title="${entry.disease}">${entry.disease}</div>
          <div class="history-entry-meta">
            <span class="history-entry-conf ${confClass}">${entry.confidence.toFixed(1)}%</span>
            <span class="history-entry-dot"></span>
            <span>${entry.isHealthy ? 'Healthy' : 'Disease'}</span>
          </div>
        </div>
        <div class="history-entry-time">${entry.time}</div>
      `;
      card.addEventListener('click', () => {
        toggleHistoryDrawer(false);   // close drawer
        setTimeout(() => {
          document.getElementById('detect')?.scrollIntoView({ behavior: 'smooth' });
        }, 280);
      });
      listEl.appendChild(card);
    });
  } else {
    badge.style.display    = 'none';
    clearBtn.style.display = 'none';
    navBtn.classList.remove('active');
    listEl.querySelectorAll('.history-entry').forEach(el => el.remove());
    if (emptyEl) emptyEl.style.display = 'flex';
  }
}

function toggleHistoryDrawer(forceOpen) {
  const drawer  = document.getElementById('historyDrawer');
  const overlay = document.getElementById('historyOverlay');
  if (!drawer) return;
  const shouldOpen = forceOpen !== undefined ? forceOpen : !drawer.classList.contains('open');
  drawer.classList.toggle('open', shouldOpen);
  overlay.classList.toggle('open', shouldOpen);
  // Prevent body scroll when open
  document.body.style.overflow = shouldOpen ? 'hidden' : '';
}

// Close drawer on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') toggleHistoryDrawer(false);
});

// Init on load
document.addEventListener('DOMContentLoaded', renderHistory);

// ─── NAVBAR ──────────────────────────────
const navbar = document.getElementById('navbar');
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');

window.addEventListener('scroll', () => {
  if (window.scrollY > 40) navbar.classList.add('scrolled');
  else navbar.classList.remove('scrolled');
  updateActiveNav();
});

hamburger?.addEventListener('click', () => {
  navLinks.classList.toggle('open');
});

// Close nav on link click (mobile)
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => navLinks.classList.remove('open'));
});

function updateActiveNav() {
  const sections = ['home', 'detect', 'treatment', 'insights'];
  const scrollY = window.scrollY + 120;
  sections.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const link = document.querySelector(`.nav-link[href="#${id}"]`);
    if (!link) return;
    const { offsetTop, offsetHeight } = el;
    if (scrollY >= offsetTop && scrollY < offsetTop + offsetHeight) {
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    }
  });
}

// ─── PARTICLES ────────────────────────────
const particleContainer = document.getElementById('particles');
if (particleContainer) {
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.cssText = `
      left: ${Math.random() * 100}%;
      --dur: ${6 + Math.random() * 8}s;
      --delay: ${Math.random() * 8}s;
      width: ${3 + Math.random() * 5}px;
      height: ${3 + Math.random() * 5}px;
      opacity: 0.6;
    `;
    particleContainer.appendChild(p);
  }
}

// ─── FILE UPLOAD ──────────────────────────
const fileInput    = document.getElementById('fileInput');
const browseBtn    = document.getElementById('browseBtn');
const uploadZone   = document.getElementById('uploadZone');
const previewWrap  = document.getElementById('previewWrap');
const previewImg   = document.getElementById('previewImg');
const removeBtn    = document.getElementById('removeBtn');
const analyzeBtn   = document.getElementById('analyzeBtn');

let currentFile    = null;
let capturedDataURL = null;

browseBtn?.addEventListener('click', () => fileInput.click());

uploadZone?.addEventListener('click', e => {
  if (e.target !== browseBtn) fileInput.click();
});

fileInput?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) handleFileSelect(file);
});

// Drag & drop
uploadZone?.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone?.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));

uploadZone?.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) handleFileSelect(file);
});

function handleFileSelect(file) {
  currentFile = file;
  capturedDataURL = null;
  const reader = new FileReader();
  reader.onload = ev => {
    previewImg.src = ev.target.result;
    uploadZone.style.display = 'none';
    previewWrap.style.display = 'block';
    enableAnalyze();
  };
  reader.readAsDataURL(file);
}

removeBtn?.addEventListener('click', () => {
  currentFile = null;
  fileInput.value = '';
  previewImg.src = '';
  previewWrap.style.display = 'none';
  uploadZone.style.display = 'block';
  checkAnalyzeState();
});

// ─── CAMERA ───────────────────────────────
const openCamBtn   = document.getElementById('openCamBtn');
const captureBtn   = document.getElementById('captureBtn');
const retakeBtn    = document.getElementById('retakeBtn');
const cameraFeed   = document.getElementById('cameraFeed');
const cameraCanvas = document.getElementById('cameraCanvas');
const capturedImg  = document.getElementById('capturedImg');
const cameraPlaceholder = document.getElementById('cameraPlaceholder');
let cameraStream = null;

openCamBtn?.addEventListener('click', async () => {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    cameraFeed.srcObject = cameraStream;
    cameraFeed.style.display = 'block';
    cameraPlaceholder.style.display = 'none';
    capturedImg.style.display = 'none';
    openCamBtn.style.display = 'none';
    captureBtn.style.display = 'flex';
  } catch (err) {
    showToast('Camera access denied. Please allow camera permissions.', 'error');
  }
});

captureBtn?.addEventListener('click', () => {
  cameraCanvas.width  = cameraFeed.videoWidth;
  cameraCanvas.height = cameraFeed.videoHeight;
  cameraCanvas.getContext('2d').drawImage(cameraFeed, 0, 0);
  capturedDataURL = cameraCanvas.toDataURL('image/jpeg', 0.92);
  capturedImg.src = capturedDataURL;
  // Stop stream
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  cameraFeed.style.display = 'none';
  capturedImg.style.display = 'block';
  captureBtn.style.display = 'none';
  retakeBtn.style.display = 'flex';
  currentFile = null;
  enableAnalyze();
});

retakeBtn?.addEventListener('click', () => {
  capturedDataURL = null;
  capturedImg.style.display = 'none';
  cameraPlaceholder.style.display = 'block';
  retakeBtn.style.display = 'none';
  openCamBtn.style.display = 'flex';
  checkAnalyzeState();
});

// ─── ANALYZE ──────────────────────────────
function enableAnalyze()  { analyzeBtn.disabled = false; }
function checkAnalyzeState() {
  analyzeBtn.disabled = !(currentFile || capturedDataURL);
}

// ─── HANDLE FILE UPLOAD → /predict_upload ────────────────
async function handleFileUpload(file) {
  const formData = new FormData();
  formData.append('file', file);

  // <--- NEW: Grab plant selection and add to FormData --->
  const plantDropdown = document.getElementById('plant-dropdown');
  if (plantDropdown) {
    formData.append('plant', plantDropdown.value);
  }

  const response = await fetch(`${API_BASE}/predict_upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(err.detail || `Server error ${response.status}`);
  }
  return response.json();   // { disease, confidence, gradcam_base64 }
}

// ─── HANDLE ESP-32 CAPTURE → /predict_esp32 ──────────────
async function handleESP32Capture() {
  setAnalyzingState(true, 'Capturing from ESP-32…');
  try {
    // <--- NEW: Create FormData and add plant selection --->
    const formData = new FormData();
    const plantDropdown = document.getElementById('plant-dropdown');
    if (plantDropdown) {
      formData.append('plant', plantDropdown.value);
    }

    const response = await fetch(`${API_BASE}/predict_esp32`, { 
        method: 'POST',
        body: formData // <--- NEW: Send the FormData
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(err.detail || `Server error ${response.status}`);
    }
    const data = await response.json();
    showResult(data.disease, data.confidence, '', data.gradcam_base64);
    fetchWikiData(data.disease.replace(/[^a-zA-Z ]/g, '').trim());
  } catch (err) {
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      showToast('🔌 Cannot reach backend. Is uvicorn running on port 8000?', 'error');
    } else if (err.message.toLowerCase().includes('esp')) {
      showToast(`📷 ESP-32 offline: ${err.message}`, 'error');
    } else {
      showToast(`ESP-32 Capture failed: ${err.message}`, 'error');
    }
  } finally {
    setAnalyzingState(false);
  }
}

// ─── ANALYZE BUTTON (file / webcam capture) ───────────────
analyzeBtn?.addEventListener('click', async () => {
  setAnalyzingState(true, 'Analyzing…');
  try {
    let fileToSend = null;
    if (currentFile) {
      fileToSend = currentFile;
    } else if (capturedDataURL) {
      fileToSend = dataURLtoBlob(capturedDataURL);
      fileToSend = new File([fileToSend], 'capture.jpg', { type: 'image/jpeg' });
    } else {
      throw new Error('No image selected.');
    }
    const data = await handleFileUpload(fileToSend);
    showResult(data.disease, data.confidence, '', data.gradcam_base64);
    fetchWikiData(data.disease.replace(/[^a-zA-Z ]/g, '').trim());
  } catch (err) {
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      showToast('🔌 Cannot reach backend. Is uvicorn running on port 8000?', 'error');
    } else {
      showToast(`Analysis failed: ${err.message}`, 'error');
    }
  } finally {
    setAnalyzingState(false);
  }
});

// ─── UI HELPERS ───────────────────────────────────────────
function setAnalyzingState(isLoading, label = 'Analyzing…') {
  const analyzeIcon    = document.getElementById('analyzeIcon');
  const analyzeSpinner = document.getElementById('analyzeSpinner');
  analyzeBtn.disabled  = isLoading;
  if (isLoading) {
    analyzeIcon.style.display    = 'none';
    analyzeSpinner.style.display = 'inline-block';
    analyzeBtn.dataset.origText  = analyzeBtn.innerText;
    analyzeBtn.lastChild.textContent = '  ' + label;
  } else {
    analyzeIcon.style.display    = 'inline-block';
    analyzeSpinner.style.display = 'none';
    checkAnalyzeState();
  }
}

function showResult(disease, confidence, description = '', gradcamB64 = '') {
  // ── Save to session history ───────────────────────────────
  addHistoryEntry(disease, confidence);
  const resultCard       = document.getElementById('resultCard');
  const resultDisease    = document.getElementById('resultDisease');
  const resultConfidence = document.getElementById('resultConfidence');
  const resultDesc       = document.getElementById('resultDesc');
  resultDisease.textContent    = disease;
  resultConfidence.textContent = confidence.toFixed(1) + '%';
  resultDesc.textContent       = description || getDiseaseDescription(disease);
  resultCard.style.display     = 'block';
  
  // ── Grad-CAM image ───────────────────────────────────────
  let gradcamWrap = document.getElementById('gradcamWrap');
  if (!gradcamWrap) {
    gradcamWrap = document.createElement('div');
    gradcamWrap.id = 'gradcamWrap';
    gradcamWrap.style.cssText = `
      margin-top: 1rem;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid rgba(74,222,128,0.2);
    `;
    const label = document.createElement('p');
    label.style.cssText = 'margin:0;padding:8px 12px;font-size:0.75rem;color:var(--text-dim,#9ca3af);background:rgba(0,0,0,0.2);';
    label.textContent = '🔬 Grad-CAM — AI Attention Heatmap';
    const img = document.createElement('img');
    img.id = 'gradcamImg';
    img.alt = 'Grad-CAM heatmap';
    img.style.cssText = 'width:100%;display:block;max-height:260px;object-fit:contain;background:#000;';
    gradcamWrap.appendChild(label);
    gradcamWrap.appendChild(img);
    resultCard.querySelector('.result-body').appendChild(gradcamWrap);
  }
  
  const gradcamImg = document.getElementById('gradcamImg');
  if (gradcamB64) {
    gradcamImg.src = 'data:image/jpeg;base64,' + gradcamB64;
    gradcamWrap.style.display = 'block';
  } else {
    gradcamWrap.style.display = 'none';
  }
  
  // Animate in
  resultCard.style.opacity   = '0';
  resultCard.style.transform = 'translateY(20px)';
  requestAnimationFrame(() => {
    resultCard.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    resultCard.style.opacity    = '1';
    resultCard.style.transform  = 'translateY(0)';
  });
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function getDiseaseDescription(disease) {
  // Generic fallback description when backend doesn't supply one.
  if (disease.toLowerCase().includes('healthy')) {
    return 'No disease detected. Your plant appears healthy. Continue regular monitoring and balanced fertilisation.';
  }
  return `Detected: ${disease}. Scroll down for treatment recommendations and Wikipedia insights.`;
}

// ─── WIKIPEDIA FETCH ──────────────────────
async function fetchWikiData(diseaseName) {
  const wikiPlaceholder = document.getElementById('wikiPlaceholder');
  const wikiContent     = document.getElementById('wikiContent');
  // Clean up search query
  const query = diseaseName.replace('Healthy Leaf', 'Plant leaf disease overview');
  const searchQuery = encodeURIComponent(query);
  try {
    // Step 1: Search for article title
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${searchQuery}&format=json&origin=*`
    );
    const searchData = await searchRes.json();
    const firstResult = searchData.query?.search?.[0];
    if (!firstResult) throw new Error('No wiki results');
    const pageTitle = firstResult.title;
    
    // Step 2: Fetch summary + image
    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`
    );
    const wikiData = await summaryRes.json();
    
    // Populate content
    document.getElementById('wikiTitle').textContent = wikiData.title || pageTitle;
    document.getElementById('wikiDesc').textContent  = wikiData.extract || 'No description available.';
    document.getElementById('wikiReadMore').href     = wikiData.content_urls?.desktop?.page || '#';
    
    const imgEl = document.getElementById('wikiImage');
    if (wikiData.thumbnail?.source) {
      imgEl.src = wikiData.thumbnail.source;
      imgEl.parentElement.style.display = 'block';
      document.getElementById('wikiCaption').textContent =
        wikiData.description || wikiData.title;
    } else {
      imgEl.parentElement.style.display = 'none';
    }
    
    // Quick facts
    const factsEl = document.getElementById('wikiQuickFacts');
    factsEl.innerHTML = `
      <h4>Quick Facts</h4>
      <p style="color:var(--text-dim);font-size:0.78rem;line-height:1.7">
        ${firstResult.snippet.replace(/<[^>]+>/g,'').slice(0, 280)}…
      </p>
    `;
    
    // Swap views
    wikiPlaceholder.style.display = 'none';
    wikiContent.style.display     = 'block';
    
    // Scroll to insights
    setTimeout(() => {
      document.getElementById('insights').scrollIntoView({ behavior: 'smooth' });
    }, 600);
  } catch (err) {
    console.warn('Wikipedia fetch failed:', err);
    // Keep placeholder
  }
}

// ─── UTILITIES ────────────────────────────
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function dataURLtoBlob(dataURL) {
  const arr  = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n   = bstr.length;
  const u8 = new Uint8Array(n);
  while (n--) u8[n] = bstr.charCodeAt(n);
  return new Blob([u8], { type: mime });
}

// Toast notification
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 2rem;
    right: 2rem;
    background: ${type === 'error' ? 'rgba(220,38,38,0.9)' : 'rgba(10,30,15,0.95)'};
    border: 1px solid ${type === 'error' ? 'rgba(248,113,113,0.4)' : 'rgba(74,222,128,0.3)'};
    color: #fff;
    padding: 14px 22px;
    border-radius: 12px;
    font-size: 0.875rem;
    font-family: 'Inter',sans-serif;
    backdrop-filter: blur(12px);
    z-index: 9999;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    animation: slide-in 0.3s ease;
    max-width: 360px;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slide-in { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:none; } }
  `;
  document.head.appendChild(style);
  setTimeout(() => toast.remove(), 4000);
}