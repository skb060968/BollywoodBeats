/** Deep links, sharing, install guidance, and QR-code UI. */
import QRCode from 'qrcode';

const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z]{4}$/;
let deferredInstallPrompt = null;
let closeActiveQrModal = null;

function showToast(message, duration = 3000) {
  const toast = document.getElementById('toastNotification') || document.getElementById('toast-notification');
  if (toast) {
    toast.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, duration);
    return;
  }
  const fallback = document.createElement('div');
  fallback.id = 'toast-notification';
  fallback.setAttribute('role', 'status');
  fallback.textContent = message;
  fallback.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:12px 24px;border-radius:8px;z-index:10000';
  document.body.appendChild(fallback);
  setTimeout(() => fallback.remove(), duration);
}

function normalizedRoomCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

function buildShareUrl(roomCode) {
  const url = new URL('/', window.location.origin);
  url.searchParams.set('room', roomCode);
  return url.toString();
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
});

export function initDeepLinkHandler({ roomInputId, joinScreenId, gameName }) {
  const url = new URL(window.location.href);
  const rawCode = url.searchParams.get('room');
  if (!rawCode) return null;
  url.searchParams.delete('room');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);

  const roomCode = normalizedRoomCode(rawCode);
  if (!roomCode) {
    showToast('This room link is invalid');
    return null;
  }
  const roomInput = document.getElementById(roomInputId);
  if (roomInput) roomInput.value = roomCode;
  document.getElementById(joinScreenId)?.removeAttribute('hidden');
  showToast('Room code filled from link!');
  if (!window.matchMedia('(display-mode: standalone)').matches) {
    setTimeout(() => showAppBanner(gameName), 800);
  }
  return roomCode;
}

export function createShareHandler(rawRoomCode, gameName) {
  return async function handleShare() {
    const roomCode = normalizedRoomCode(rawRoomCode);
    if (!roomCode) return;
    const shareUrl = buildShareUrl(roomCode);
    const text = `Join my ${gameName} room! Code: ${roomCode}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: gameName, text, url: shareUrl });
        return;
      } catch (error) {
        if (error.name !== 'AbortError') console.warn('Share failed:', error);
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
      showToast('Room link copied!');
    } catch (_) {
      showToast(`Room code: ${roomCode}`);
    }
  };
}

function showAppBanner(gameName) {
  if (sessionStorage.getItem('app-banner-dismissed')) return;
  document.getElementById('app-banner')?.remove();
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const banner = document.createElement('div');
  banner.id = 'app-banner';
  banner.className = 'app-banner';
  banner.innerHTML = `
    <div class="app-banner-content">
      <span class="app-banner-icon" aria-hidden="true">📱</span>
      <span class="app-banner-text">${isMobile ? 'Better experience in app' : 'Install for quicker access'}</span>
      <div class="app-banner-actions">
        <button id="app-banner-open" class="app-banner-btn primary">${deferredInstallPrompt ? 'Install App' : 'Install Help'}</button>
        <button id="app-banner-continue" class="app-banner-btn secondary">Continue Here</button>
        <button id="app-banner-close" class="app-banner-btn close" aria-label="Close">×</button>
      </div>
    </div>`;
  document.body.appendChild(banner);
  setTimeout(() => banner.classList.add('show'), 100);
  banner.querySelector('#app-banner-open')?.addEventListener('click', () => handleInstall(gameName));
  banner.querySelector('#app-banner-continue')?.addEventListener('click', dismissAppBanner);
  banner.querySelector('#app-banner-close')?.addEventListener('click', dismissAppBanner);
}

function dismissAppBanner() {
  const banner = document.getElementById('app-banner');
  banner?.classList.remove('show');
  if (banner) setTimeout(() => banner.remove(), 300);
  sessionStorage.setItem('app-banner-dismissed', 'true');
}

async function handleInstall() {
  if (!deferredInstallPrompt) {
    showToast('Use your browser menu and choose “Install app”', 4000);
    return;
  }
  try {
    await deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (result.outcome === 'accepted') {
      showToast('App installing...');
      dismissAppBanner();
    }
  } catch (error) {
    console.warn('Install prompt failed:', error);
    showToast('Use your browser menu and choose “Install app”', 4000);
  }
}

export async function showQRCode(rawRoomCode, gameName) {
  const roomCode = normalizedRoomCode(rawRoomCode);
  if (!roomCode) return;
  closeActiveQrModal?.();
  const returnFocus = document.activeElement;
  const modal = document.createElement('div');
  modal.id = 'qr-modal';
  modal.className = 'qr-modal';
  modal.innerHTML = `
    <div class="qr-modal-overlay"></div>
    <div class="qr-modal-content" role="dialog" aria-modal="true" aria-labelledby="qr-modal-title">
      <button class="qr-modal-close" aria-label="Close QR code">×</button>
      <h2 class="qr-modal-title" id="qr-modal-title">Scan to Join</h2>
      <p class="qr-modal-game">${gameName}</p>
      <div class="qr-modal-code-display"><span class="qr-code-label">Room Code:</span><span class="qr-code-value">${roomCode}</span></div>
      <div class="qr-canvas-container"><canvas id="qr-canvas"></canvas></div>
      <p class="qr-modal-hint">Scan with camera to join instantly</p>
      <div class="qr-modal-actions">
        <button class="qr-modal-btn qr-share-btn">📱 Share Link</button>
        <button class="qr-modal-btn qr-download-btn">💾 Save QR</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const closeModal = () => {
    document.removeEventListener('keydown', handleKeydown);
    closeActiveQrModal = null;
    modal.classList.remove('show');
    setTimeout(() => {
      modal.remove();
      if (returnFocus instanceof HTMLElement) returnFocus.focus();
    }, 300);
  };
  const handleKeydown = event => {
    if (event.key === 'Escape') closeModal();
  };
  closeActiveQrModal = closeModal;

  try {
    await QRCode.toCanvas(modal.querySelector('canvas'), buildShareUrl(roomCode), {
      width: 280,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' },
    });
  } catch (error) {
    console.error('Failed to generate QR code:', error);
    closeModal();
    showToast('Failed to generate QR code');
    return;
  }

  modal.querySelector('.qr-modal-close')?.addEventListener('click', closeModal);
  modal.querySelector('.qr-modal-overlay')?.addEventListener('click', closeModal);
  modal.querySelector('.qr-share-btn')?.addEventListener('click', createShareHandler(roomCode, gameName));
  modal.querySelector('.qr-download-btn')?.addEventListener('click', () => {
    try {
      const link = document.createElement('a');
      link.download = `${gameName.replace(/\s+/g, '-')}-Room-${roomCode}.png`;
      link.href = modal.querySelector('canvas').toDataURL('image/png');
      link.click();
      showToast('QR code saved!');
    } catch (error) {
      console.error('Failed to save QR code:', error);
      showToast('Failed to save QR code');
    }
  });
  document.addEventListener('keydown', handleKeydown);
  requestAnimationFrame(() => {
    modal.classList.add('show');
    modal.querySelector('.qr-modal-close')?.focus();
  });
}