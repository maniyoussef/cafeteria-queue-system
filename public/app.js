/**
 * CampusBite FIFO Queue System — Client Application
 */

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();

  // --- Application State ---
  const pageTitles = {
    auth: 'CampusBite',
    student: 'CampusBite',
    staff: 'CampusBite',
    tv: 'CampusBite',
    testbench: 'CampusBite'
  };

  const savedUser = JSON.parse(localStorage.getItem('campusbite_auth_user') || 'null');
  const initialTab = savedUser ? (savedUser.role === 'staff' ? 'staff' : 'student') : 'auth';

  function getTicketStorageKey() {
    return state.authUser ? `myCafeteriaTicket_${state.authUser.id}` : 'myCafeteriaTicket_guest';
  }

  function loadMyTicket() {
    if (state.authUser && state.authUser.role === 'staff') return null;
    return JSON.parse(localStorage.getItem(getTicketStorageKey()) || 'null');
  }

  function saveMyTicket(ticket) {
    state.myTicket = ticket;
    if (ticket) {
      localStorage.setItem(getTicketStorageKey(), JSON.stringify(ticket));
    } else {
      localStorage.removeItem(getTicketStorageKey());
    }
  }

  function clearMyTicket() {
    state.myTicket = null;
    localStorage.removeItem(getTicketStorageKey());
  }

  const state = {
    connected: false,
    soundEnabled: true,
    activeTab: initialTab,
    staffCounterId: 'hot-meals',
    myTicket: loadMyTicket(),
    serverQueues: null,
    networkIPs: [],
    authToken: localStorage.getItem('campusbite_auth_token') || null,
    authUser: savedUser
  };

  // --- Socket.IO ---
  const socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 3000,
    reconnectionAttempts: Infinity
  });

  let retryTimerInterval = null;
  let retrySecondsLeft = 3;

  socket.on('connect', () => {
    state.connected = true;
    updateConnectionUI(true);
    hideOfflineOverlay();
    showToast('Connected to server', 'success');
  });

  socket.on('disconnect', (reason) => {
    state.connected = false;
    updateConnectionUI(false);
    showOfflineOverlay();
    showToast(`Connection lost (${reason})`, 'error');
  });

  socket.on('connect_error', () => {
    state.connected = false;
    updateConnectionUI(false);
    showOfflineOverlay();
  });

  socket.on('queue:updated', (data) => {
    state.serverQueues = data;
    renderAllViews();
  });

  socket.on('ticket:called', (payload) => {
    const { ticket, counterId } = payload;
    
    // Only student clients whose ticket matches should trigger sound and ready modal!
    // Staff members who called the ticket should NOT get student pickup modal or chime!
    if (state.authUser && state.authUser.role === 'staff') {
      return;
    }

    if (state.myTicket && (state.myTicket.id === ticket.id || state.myTicket.ticketNumber === ticket.ticketNumber)) {
      state.myTicket.status = 'now_serving';
      saveMyTicket(state.myTicket);
      if (state.soundEnabled) playAudioChime();
      showToast(`Ticket #${ticket.ticketNumber}: Your order is ready at ${ticket.counterName || counterId}!`, 'success');
      showOrderReadyModal(ticket, counterId);
      renderStudentTracker();
    }
  });

  socket.on('ticket:completed', (payload) => {
    const { ticketId, completedTicket, action } = payload;
    const currentTicket = state.myTicket;
    if (!currentTicket) return;

    const isMatch = currentTicket.id === ticketId || 
                    currentTicket.ticketNumber === ticketId ||
                    (completedTicket && (currentTicket.id === completedTicket.id || currentTicket.ticketNumber === completedTicket.ticketNumber));

    if (isMatch) {
      const isNoShow = action === 'no_show' || completedTicket?.status === 'no_show';
      state.myTicket.status = isNoShow ? 'no_show' : 'completed';
      state.myTicket.finishedAt = new Date().toISOString();
      saveMyTicket(state.myTicket);

      // Close ready modal if open
      const readyModal = document.getElementById('ready-modal');
      if (readyModal) readyModal.style.display = 'none';

      if (isNoShow) {
        showToast(`Ticket #${state.myTicket.ticketNumber} was marked as no-show.`, 'warning');
      } else {
        showToast(`Your order #${state.myTicket.ticketNumber} has been handed over! Enjoy your meal.`, 'success');
        if (state.soundEnabled) playAudioChime();
      }

      renderStudentTracker();
    }
  });

  // --- Init ---
  fetchNetworkStatus();
  initAuthService();
  initNavigation();
  initStudentView();
  initStaffView();
  initTestBenchView();
  initModals();
  initOfflineOverlay();

  // Set initial active tab
  switchTab(state.activeTab);

  // ==========================================================================
  // AUTHENTICATION & ROLE-BASED ACCESS CONTROL
  // ==========================================================================
  function initAuthService() {
    // 1. Hook Direct Login Form
    const authForm = document.getElementById('auth-login-form');
    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('auth-username').value.trim();
        const password = document.getElementById('auth-password').value;
        await handleLogin(username, password);
      });
    }

    // 2. Hook Header Auth Action Button (Sign In / Sign Out)
    const headerAuthBtn = document.getElementById('btn-header-auth-action');
    if (headerAuthBtn) {
      headerAuthBtn.addEventListener('click', () => {
        if (state.authUser) {
          handleLogout();
        } else {
          switchTab('auth');
        }
      });
    }

    // 3. Hook Quick-login Profile Cards
    document.querySelectorAll('.credential-card').forEach(card => {
      card.addEventListener('click', () => {
        const username = card.dataset.username;
        const password = card.dataset.password;
        if (username && password) {
          document.getElementById('auth-username').value = username;
          document.getElementById('auth-password').value = password;
          handleLogin(username, password);
        }
      });
    });

    // 4. Validate or Restore Session
    if (state.authToken) {
      fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${state.authToken}` }
      })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.user) {
          state.authUser = data.user;
          localStorage.setItem('campusbite_auth_user', JSON.stringify(data.user));
          applyUserSession(data.user);
        } else {
          handleLogout(false);
        }
      })
      .catch(() => {
        if (state.authUser) applyUserSession(state.authUser);
      });
    } else {
      applyLoggedOutState();
    }
  }

  async function handleLogin(username, password) {
    const errorAlert = document.getElementById('auth-error-alert');
    const errorText = document.getElementById('auth-error-text');
    const submitBtn = document.getElementById('btn-auth-submit');

    if (errorAlert) errorAlert.style.display = 'none';
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (submitBtn) submitBtn.disabled = false;

      if (data.success && data.token) {
        state.authToken = data.token;
        state.authUser = data.user;
        localStorage.setItem('campusbite_auth_token', data.token);
        localStorage.setItem('campusbite_auth_user', JSON.stringify(data.user));

        showToast(`Welcome, ${data.user.name}`, 'success');
        applyUserSession(data.user);

        // Direct to designated backoffice
        if (data.user.role === 'staff') {
          switchTab('staff');
        } else {
          switchTab('student');
        }
      } else {
        if (errorAlert && errorText) {
          errorText.textContent = data.error || 'Invalid credentials. Please verify username and password.';
          errorAlert.style.display = 'flex';
          if (window.lucide) window.lucide.createIcons();
        }
      }
    } catch (err) {
      if (submitBtn) submitBtn.disabled = false;
      if (errorAlert && errorText) {
        errorText.textContent = 'Network error contacting authentication service.';
        errorAlert.style.display = 'flex';
      }
    }
  }

  function handleLogout(notify = true) {
    if (state.authToken) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.authToken}`
        }
      }).catch(() => {});
    }

    state.authToken = null;
    state.authUser = null;
    localStorage.removeItem('campusbite_auth_token');
    localStorage.removeItem('campusbite_auth_user');

    applyLoggedOutState();
    switchTab('auth');
    if (notify) showToast('Signed out successfully', 'info');
  }

  function applyUserSession(user) {
    // Header Profile Pill
    const pill = document.getElementById('user-profile-pill');
    const nameEl = document.getElementById('user-display-name');
    const roleTag = document.getElementById('user-role-tag');
    const authActionBtn = document.getElementById('btn-header-auth-action');
    const roleIcon = document.getElementById('user-role-icon');

    if (pill && nameEl && roleTag && authActionBtn) {
      pill.style.display = 'inline-flex';
      nameEl.textContent = user.name;
      roleTag.textContent = user.role === 'staff' ? 'Staff Server' : 'Client';
      roleTag.className = `user-role-tag ${user.role}`;
      authActionBtn.textContent = 'Sign Out';
      if (roleIcon) {
        roleIcon.setAttribute('data-lucide', user.role === 'staff' ? 'chef-hat' : 'user');
      }
    }

    // Role-based navigation tab isolation
    const tabAuth = document.getElementById('tab-auth');
    const tabStudent = document.getElementById('tab-student');
    const tabStaff = document.getElementById('tab-staff');
    const tabTv = document.getElementById('tab-tv');
    const tabBench = document.getElementById('tab-testbench');

    if (tabAuth) tabAuth.style.display = 'none';

    if (user.role === 'student') {
      // Student Backoffice: Client Portal + Public TV Display
      if (tabStudent) tabStudent.style.display = 'inline-flex';
      if (tabStaff) tabStaff.style.display = 'none';
      if (tabTv) tabTv.style.display = 'inline-flex';
      if (tabBench) tabBench.style.display = 'none';

      state.myTicket = loadMyTicket();
      renderStudentTracker();

      // Pre-populate student join queue form with authenticated client details
      const nameInput = document.getElementById('studentName');
      const idInput = document.getElementById('studentId');
      const authHint = document.getElementById('student-auth-hint');
      const loggedName = document.getElementById('student-logged-name');
      const loggedId = document.getElementById('student-logged-id');

      if (nameInput) nameInput.value = user.name;
      if (idInput && user.studentId) idInput.value = user.studentId;
      if (authHint && loggedName && loggedId) {
        loggedName.textContent = user.name;
        loggedId.textContent = user.studentId || 'STU';
        authHint.style.display = 'flex';
      }
    } else if (user.role === 'staff') {
      // Staff Backoffice: Staff Queue Dashboard + TV Display + Concurrency Bench
      if (tabStudent) tabStudent.style.display = 'none';
      if (tabStaff) tabStaff.style.display = 'inline-flex';
      if (tabTv) tabTv.style.display = 'inline-flex';
      if (tabBench) tabBench.style.display = 'inline-flex';

      state.myTicket = null; // Staff operates the server, does not hold client tickets
      const authHint = document.getElementById('student-auth-hint');
      if (authHint) authHint.style.display = 'none';
    }

    if (window.lucide) window.lucide.createIcons();
  }

  function applyLoggedOutState() {
    const pill = document.getElementById('user-profile-pill');
    const authActionBtn = document.getElementById('btn-header-auth-action');
    if (pill) pill.style.display = 'none';
    if (authActionBtn) authActionBtn.textContent = 'Sign In';

    state.myTicket = loadMyTicket();
    renderStudentTracker();

    const tabAuth = document.getElementById('tab-auth');
    const tabStudent = document.getElementById('tab-student');
    const tabStaff = document.getElementById('tab-staff');
    const tabTv = document.getElementById('tab-tv');
    const tabBench = document.getElementById('tab-testbench');

    if (tabAuth) tabAuth.style.display = 'inline-flex';
    if (tabStudent) tabStudent.style.display = 'inline-flex';
    if (tabStaff) tabStaff.style.display = 'inline-flex';
    if (tabTv) tabTv.style.display = 'inline-flex';
    if (tabBench) tabBench.style.display = 'inline-flex';

    const authHint = document.getElementById('student-auth-hint');
    if (authHint) authHint.style.display = 'none';

    if (window.lucide) window.lucide.createIcons();
  }

  // ==========================================================================
  // NAVIGATION (Sidebar + Mobile)
  // ==========================================================================
  function initNavigation() {
    // Nav buttons & sidebar links
    document.querySelectorAll('.sidebar-link, .nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Mobile menu
    const menuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');

    if (menuBtn) {
      menuBtn.addEventListener('click', () => {
        sidebar?.classList.toggle('open');
        overlay?.classList.toggle('visible');
      });
    }
    if (overlay) {
      overlay.addEventListener('click', () => {
        sidebar?.classList.remove('open');
        overlay?.classList.remove('visible');
      });
    }

    // Close sidebar on nav click (mobile)
    document.querySelectorAll('.sidebar-link, .nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          sidebar?.classList.remove('open');
          overlay?.classList.remove('visible');
        }
      });
    });
  }

  function switchTab(tab) {
    document.querySelectorAll('.sidebar-link, .nav-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    const activeBtns = document.querySelectorAll(`.sidebar-link[data-tab="${tab}"], .nav-btn[data-tab="${tab}"]`);
    activeBtns.forEach(b => {
      b.classList.add('active');
      b.setAttribute('aria-selected', 'true');
    });

    document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`view-${tab}`);
    if (panel) panel.classList.add('active');

    state.activeTab = tab;
    document.getElementById('page-title').textContent = pageTitles[tab] || 'CampusBite';
    renderAllViews();
  }

  // ==========================================================================
  // TOAST NOTIFICATIONS
  // ==========================================================================
  function showToast(message, type = 'error') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = { success: 'check-circle', error: 'alert-circle', warning: 'alert-triangle' };
    toast.innerHTML = `<i data-lucide="${icons[type] || 'info'}"></i> <span>${message}</span>`;
    container.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px)';
      toast.style.transition = 'all .25s ease';
      setTimeout(() => toast.remove(), 250);
    }, 3500);
  }

  // ==========================================================================
  // CONFIRM DIALOG (replaces native confirm())
  // ==========================================================================
  function showConfirm(title, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      modal.style.display = 'flex';

      const okBtn = document.getElementById('confirm-ok-btn');
      const cancelBtn = document.getElementById('confirm-cancel-btn');

      function cleanup(result) {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        resolve(result);
      }
      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
    });
  }

  // ==========================================================================
  // OFFLINE OVERLAY
  // ==========================================================================
  function showOfflineOverlay() {
    const overlay = document.getElementById('offline-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';

    if (retryTimerInterval) clearInterval(retryTimerInterval);
    retrySecondsLeft = 3;
    const timer = document.getElementById('offline-retry-timer');
    if (timer) timer.textContent = `Retrying in ${retrySecondsLeft}s…`;

    retryTimerInterval = setInterval(() => {
      retrySecondsLeft -= 1;
      if (retrySecondsLeft <= 0) { retrySecondsLeft = 3; socket.connect(); }
      if (timer) timer.textContent = `Retrying in ${retrySecondsLeft}s…`;
    }, 1000);
  }

  function hideOfflineOverlay() {
    const overlay = document.getElementById('offline-overlay');
    if (overlay) overlay.style.display = 'none';
    if (retryTimerInterval) clearInterval(retryTimerInterval);
  }

  function initOfflineOverlay() {
    const btn = document.getElementById('btn-manual-reconnect');
    if (btn) {
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader-2"></i> Connecting…`;
        socket.connect();
        setTimeout(() => {
          btn.disabled = false;
          btn.innerHTML = `<i data-lucide="refresh-cw"></i> Retry Now`;
          if (window.lucide) window.lucide.createIcons();
        }, 1500);
      });
    }
  }

  // ==========================================================================
  // CONNECTION UI
  // ==========================================================================
  function updateConnectionUI(isConnected) {
    // Sidebar indicator
    const dots = document.querySelectorAll('.indicator-dot');
    const labels = document.querySelectorAll('.status-label');
    dots.forEach(d => { d.className = `indicator-dot ${isConnected ? 'connected' : 'disconnected'}`; });
    labels.forEach(l => { if (l) l.textContent = isConnected ? 'Connected' : 'Reconnecting…'; });

    const statusText = document.getElementById('network-status-text');
    if (statusText) statusText.textContent = isConnected ? 'Connected to server' : 'Connecting…';
  }

  async function fetchNetworkStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      state.networkIPs = data.networkIPs || [];
      renderNetworkInfo();
    } catch (e) { /* silent */ }
  }

  // ==========================================================================
  // AUDIO CHIME
  // ==========================================================================
  function playAudioChime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      [523.25, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const t = ctx.currentTime + i * 0.15;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.5);
      });
    } catch (e) { /* silent */ }
  }

  // ==========================================================================
  // VIEW 1: STUDENT
  // ==========================================================================
  const selectedItems = new Set();

  function initStudentView() {
    const chipsContainer = document.getElementById('item-chips-container');
    if (chipsContainer) {
      chipsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const item = chip.dataset.item;
        if (selectedItems.has(item)) { selectedItems.delete(item); chip.classList.remove('selected'); }
        else { selectedItems.add(item); chip.classList.add('selected'); }
      });
    }

    const form = document.getElementById('join-queue-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const counterId = form.querySelector('input[name="counterId"]:checked').value;
        const studentName = document.getElementById('studentName').value.trim();
        const studentId = document.getElementById('studentId').value.trim();
        const notes = document.getElementById('orderNotes').value.trim();
        const items = Array.from(selectedItems);
        if (!items.length && !notes) items.push('Standard Meal Deal');

        const btn = document.getElementById('btn-join');
        try {
          btn.disabled = true;
          btn.innerHTML = `<i data-lucide="loader-2"></i> Joining…`;
          if (window.lucide) window.lucide.createIcons();

          const res = await fetch('/api/queue/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ counterId, studentName, studentId, items, notes })
          });
          const data = await res.json();
          if (data.success) {
            saveMyTicket(data.ticket);
            showToast(`Ticket ${data.ticket.ticketNumber} issued`, 'success');
            renderStudentTracker();
          } else {
            showToast('Failed to join: ' + (data.error || 'Unknown error'), 'error');
          }
        } catch (err) {
          showToast('Network error: ' + err.message, 'error');
        } finally {
          btn.disabled = false;
          btn.innerHTML = `<i data-lucide="arrow-right"></i> Join Queue`;
          if (window.lucide) window.lucide.createIcons();
        }
      });
    }

    document.getElementById('btn-cancel-ticket')?.addEventListener('click', async () => {
      if (!state.myTicket) return;
      const confirmed = await showConfirm('Leave queue?', 'You will lose your position in line. This cannot be undone.');
      if (!confirmed) return;
      try {
        await fetch('/api/queue/leave', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ counterId: state.myTicket.counterId, ticketId: state.myTicket.id })
        });
        showToast('You have left the queue', 'warning');
        clearMyTicket();
        renderStudentTracker();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });

    document.getElementById('btn-new-ticket')?.addEventListener('click', () => {
      clearMyTicket();
      renderStudentTracker();
    });

    document.getElementById('btn-sound-toggle')?.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      document.getElementById('sound-text').textContent = state.soundEnabled ? 'Sound On' : 'Sound Off';
      document.getElementById('sound-icon').setAttribute('data-lucide', state.soundEnabled ? 'volume-2' : 'volume-x');
      if (window.lucide) window.lucide.createIcons();
    });
  }

  function renderStudentTracker() {
    const joinCard = document.getElementById('student-join-card');
    const trackerCard = document.getElementById('student-tracker-card');

    if (!state.myTicket) {
      if (joinCard) joinCard.style.display = 'block';
      if (trackerCard) trackerCard.style.display = 'none';
      return;
    }

    if (joinCard) joinCard.style.display = 'block';
    if (trackerCard) trackerCard.style.display = 'block';

    const t = state.myTicket;
    document.getElementById('ticket-counter-name').textContent = t.counterName || 'Cafeteria Counter';
    document.getElementById('ticket-number-display').textContent = t.ticketNumber;
    document.getElementById('ticket-student-name').textContent = t.studentName;
    document.getElementById('ticket-items-list').textContent = (t.items?.length) ? t.items.join(', ') : 'Standard Meal';
    document.getElementById('ticket-joined-time').textContent = new Date(t.timestampMs || Date.now()).toLocaleTimeString();

    const readyCallout = document.getElementById('ready-callout');
    const expiredBanner = document.getElementById('ticket-expired-banner');
    const statusPill = document.getElementById('ticket-status-pill');
    const statusText = document.getElementById('ticket-status-text');
    const positionEl = document.getElementById('ticket-position');
    const waitEstEl = document.getElementById('ticket-wait-est');
    const cancelBtn = document.getElementById('btn-cancel-ticket');
    const newTicketBtn = document.getElementById('btn-new-ticket');
    const ticketNumEl = document.getElementById('ticket-number-display');

    if (expiredBanner) expiredBanner.style.display = 'none';
    if (readyCallout) readyCallout.style.display = 'none';
    if (ticketNumEl) ticketNumEl.classList.remove('strikethrough');

    const counter = state.serverQueues?.counters?.[t.counterId];

    // State 1: Currently being called / served at counter
    if (counter?.servingTicket && (counter.servingTicket.id === t.id || counter.servingTicket.ticketNumber === t.ticketNumber)) {
      t.status = 'now_serving';
      statusPill.className = 'ticket-status-pill status-serving';
      statusText.innerHTML = '<i data-lucide="bell"></i> Now Serving';
      positionEl.textContent = 'NOW';
      positionEl.style.color = '';
      waitEstEl.textContent = '0 min';
      if (readyCallout) {
        readyCallout.style.display = 'flex';
        document.getElementById('ready-counter-name').textContent = t.counterName;
        document.getElementById('ready-ticket-num').textContent = t.ticketNumber;
      }
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (newTicketBtn) newTicketBtn.style.display = 'block';
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    // Check if waiting in active FIFO queue
    const activeQueue = counter?.activeQueue || [];
    const foundIdx = activeQueue.findIndex(item => item.id === t.id || item.ticketNumber === t.ticketNumber);

    if (foundIdx !== -1) {
      // State 2: Waiting in queue
      const q = activeQueue[foundIdx];
      t.status = 'in_queue';
      statusPill.className = 'ticket-status-pill status-in-queue';
      statusText.innerHTML = '<i data-lucide="clock"></i> In Queue';
      positionEl.textContent = `#${q.position}`;
      positionEl.style.color = '';
      document.getElementById('ticket-total-waiting').textContent = `of ${activeQueue.length} in queue`;
      waitEstEl.textContent = `~${q.estimatedWaitMinutes} min`;
      if (readyCallout) readyCallout.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = 'block';
      if (newTicketBtn) newTicketBtn.style.display = 'none';
    } else {
      // State 3: Either completed, marked no-show, or cancelled
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (newTicketBtn) newTicketBtn.style.display = 'block';

      if (t.status === 'no_show') {
        statusPill.className = 'ticket-status-pill status-expired';
        statusText.innerHTML = '<i data-lucide="user-x"></i> No-Show / Missed';
        positionEl.textContent = 'MISSED';
        waitEstEl.textContent = '0 min';
        if (ticketNumEl) ticketNumEl.classList.add('strikethrough');
        if (expiredBanner) {
          expiredBanner.style.display = 'flex';
          const expDesc = expiredBanner.querySelector('.alert-body p');
          if (expDesc) expDesc.textContent = 'Your ticket was marked as no-show by staff. Please proceed to the counter or join a new line.';
        }
      } else {
        // State 4: Completed & Handed Over
        t.status = 'completed';
        statusPill.className = 'ticket-status-pill status-completed';
        statusText.innerHTML = '<i data-lucide="check-check"></i> Completed & Handed Over';
        positionEl.textContent = 'SERVED';
        waitEstEl.textContent = '0 min';
      }
    }
    if (window.lucide) window.lucide.createIcons();
  }

  // ==========================================================================
  // VIEW 2: STAFF DASHBOARD
  // ==========================================================================
  function initStaffView() {
    document.querySelectorAll('#staff-counter-tabs .tab-btn').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#staff-counter-tabs .tab-btn').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.staffCounterId = tab.dataset.counter;
        renderStaffDashboard();
      });
    });

    document.getElementById('btn-serve-next')?.addEventListener('click', () => serveNextStudent());

    window.addEventListener('keydown', (e) => {
      if (state.activeTab === 'staff' && e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
        e.preventDefault();
        serveNextStudent();
      }
    });

    document.getElementById('btn-complete-serving')?.addEventListener('click', () => completeServing('complete'));
    document.getElementById('btn-recall-serving')?.addEventListener('click', () => {
      if (!state.serverQueues) return;
      const counter = state.serverQueues.counters[state.staffCounterId];
      if (counter?.servingTicket) { socket.emit('staff:recall', { ticket: counter.servingTicket }); playAudioChime(); }
    });
    document.getElementById('btn-noshow-serving')?.addEventListener('click', () => completeServing('no_show'));
  }

  async function serveNextStudent() {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (state.authToken) headers['Authorization'] = `Bearer ${state.authToken}`;

      const res = await fetch('/api/staff/serve-next', {
        method: 'POST',
        headers,
        body: JSON.stringify({ counterId: state.staffCounterId })
      });
      const data = await res.json();
      if (!data.success) {
        showToast(data.message || data.error || 'No students waiting', 'warning');
      } else {
        showToast(`Calling ${data.ticket.ticketNumber} — ${data.ticket.studentName}`, 'success');
      }
    } catch (err) {
      showToast('Server error: ' + err.message, 'error');
    }
  }

  async function completeServing(action = 'complete') {
    if (!state.serverQueues) return;
    const counter = state.serverQueues.counters[state.staffCounterId];
    if (!counter?.servingTicket) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (state.authToken) headers['Authorization'] = `Bearer ${state.authToken}`;

      const res = await fetch('/api/staff/complete', {
        method: 'POST',
        headers,
        body: JSON.stringify({ counterId: state.staffCounterId, ticketId: counter.servingTicket.id, action })
      });
      const data = await res.json();
      if (data.success) {
        showToast(action === 'no_show' ? 'Marked as no-show' : 'Ticket completed', 'success');
      } else {
        showToast(data.error || 'Action failed', 'error');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  }

  function renderStaffDashboard() {
    if (!state.serverQueues) return;
    const data = state.serverQueues;
    const counter = data.counters[state.staffCounterId];

    document.getElementById('staff-count-hm').textContent = data.counters['hot-meals']?.activeCount || 0;
    document.getElementById('staff-count-sd').textContent = data.counters['snacks-drinks']?.activeCount || 0;
    document.getElementById('staff-count-ex').textContent = data.counters['express-deli']?.activeCount || 0;
    document.getElementById('stat-total-waiting').textContent = data.totalActive;
    document.getElementById('stat-total-served').textContent = data.totalServed;
    document.getElementById('stat-avg-wait').textContent = `${counter?.avgWaitMinutes || 0}m`;

    if (!counter) return;
    document.getElementById('staff-current-counter-title').textContent = `${counter.name} — Controls`;
    document.getElementById('staff-queue-count-badge').textContent = `${counter.activeCount} waiting`;

    const emptyState = document.getElementById('serving-empty-state');
    const activeContent = document.getElementById('serving-active-content');

    if (counter.servingTicket) {
      emptyState.style.display = 'none';
      activeContent.style.display = 'block';
      const t = counter.servingTicket;
      document.getElementById('staff-serving-number').textContent = t.ticketNumber;
      document.getElementById('staff-serving-name').textContent = t.studentName + (t.studentId ? ` (${t.studentId})` : '');
      document.getElementById('staff-serving-items').innerHTML = (t.items || []).map(i => `<span class="item-badge">${i}</span>`).join('');
      document.getElementById('staff-serving-notes').textContent = t.notes ? `"${t.notes}"` : '';
    } else {
      emptyState.style.display = 'flex';
      activeContent.style.display = 'none';
    }

    const queueList = document.getElementById('staff-queue-list');
    if (!counter.activeQueue?.length) {
      queueList.innerHTML = `<div class="empty-state"><i data-lucide="check-circle-2"></i><p>No one is waiting. A quiet moment.</p></div>`;
    } else {
      queueList.innerHTML = counter.activeQueue.map((item, idx) => `
        <div class="queue-item">
          <div class="queue-pos">${idx + 1}</div>
          <div class="queue-ticket-num">${item.ticketNumber}</div>
          <div class="queue-meta">
            <strong>${item.studentName}</strong>
            <span>${(item.items || []).join(', ') || 'Standard Order'}${item.notes ? ` · ${item.notes}` : ''}</span>
          </div>
          <span class="queue-item-badge">~${item.estimatedWaitMinutes}m</span>
        </div>
      `).join('');
    }
    if (window.lucide) window.lucide.createIcons();
  }

  // ==========================================================================
  // VIEW 3: TV DISPLAY
  // ==========================================================================
  function renderTVDisplay() {
    if (!state.serverQueues) return;
    const clockEl = document.getElementById('tv-clock-display');
    if (clockEl) clockEl.textContent = new Date().toLocaleTimeString();

    const grid = document.getElementById('tv-counters-grid');
    if (!grid) return;

    grid.innerHTML = Object.values(state.serverQueues.counters).map(counter => {
      const serving = counter.servingTicket;
      const next = counter.activeQueue.slice(0, 5);
      return `
        <div class="tv-counter-card">
          <div class="tv-counter-title">${counter.name}</div>
          <div class="tv-now-serving-box">
            <div class="tv-serving-label">Now Serving</div>
            <div class="tv-serving-num">${serving ? serving.ticketNumber : '—'}</div>
            <div class="tv-serving-name">${serving ? serving.studentName : 'Please wait'}</div>
          </div>
          <div class="tv-up-next-list">
            <h4>Up Next (${counter.activeQueue.length})</h4>
            <div class="tv-next-chips">
              ${next.length ? next.map(t => `<span class="tv-next-chip">${t.ticketNumber}</span>`).join('') : '<span style="color:var(--ink-muted);font-size:0.875rem;font-style:italic;">Empty</span>'}
            </div>
          </div>
        </div>`;
    }).join('');
  }

  setInterval(() => { if (state.activeTab === 'tv') renderTVDisplay(); }, 1000);

  // ==========================================================================
  // VIEW 4: TEST BENCH
  // ==========================================================================
  function initTestBenchView() {
    document.getElementById('btn-run-concurrency-test')?.addEventListener('click', async () => {
      const counterId = document.getElementById('sim-counter-select').value;
      const count = parseInt(document.getElementById('sim-count-select').value, 10);
      const btn = document.getElementById('btn-run-concurrency-test');

      logBench(`Launching ${count} parallel requests to '${counterId}'…`, 'info');
      try {
        btn.disabled = true;
        const res = await fetch('/api/test/concurrent-join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ counterId, count })
        });
        const data = await res.json();
        btn.disabled = false;
        if (data.success) {
          logBench(`${data.processedCount} requests processed in ${data.durationMs}ms`, 'success');
          data.tickets.forEach(t => logBench(`  ${t.ticketNumber} > #${t.position} ${t.studentName}`, 'success'));
        } else {
          logBench(`Failed: ${data.error}`, 'warn');
        }
      } catch (err) {
        btn.disabled = false;
        logBench(`Network error: ${err.message}`, 'warn');
      }
    });

    document.getElementById('btn-reset-queues')?.addEventListener('click', async () => {
      const confirmed = await showConfirm('Reset all queues?', 'This will remove all tickets from every counter.');
      if (!confirmed) return;
      try {
        await fetch('/api/queue/reset', { method: 'POST' });
        logBench('All queues reset', 'info');
        showToast('All queues have been reset', 'warning');
      } catch (e) {
        logBench('Reset failed: ' + e.message, 'warn');
      }
    });
  }

  function logBench(msg, type = 'info') {
    const container = document.getElementById('bench-log-container');
    if (!container) return;
    const p = document.createElement('p');
    p.className = `log-entry log-${type}`;
    p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    container.prepend(p);
  }

  function renderNetworkInfo() {
    const list = document.getElementById('network-ip-list');
    const qrText = document.getElementById('qr-url-display');
    const qrContainer = document.getElementById('qrcode-container');
    if (!list) return;

    const hostname = window.location.hostname;
    const port = window.location.port || '3000';
    const primaryUrl = `http://${hostname}:${port}`;

    let html = `<div class="ip-item"><span class="ip-label">Browser Host</span><code class="ip-value">${primaryUrl}</code></div>`;
    state.networkIPs.forEach(ip => {
      html += `<div class="ip-item"><span class="ip-label">${ip.interface}</span><code class="ip-value">http://${ip.address}:${port}</code></div>`;
    });
    list.innerHTML = html;
    if (qrText) qrText.textContent = primaryUrl;

    if (qrContainer && window.QRCode) {
      qrContainer.innerHTML = '';
      new window.QRCode(qrContainer, { text: primaryUrl, width: 120, height: 120, colorDark: '#000000', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.H });
    }
  }

  // ==========================================================================
  // MODALS
  // ==========================================================================
  function initModals() {
    document.getElementById('btn-modal-dismiss')?.addEventListener('click', () => {
      document.getElementById('ready-modal').style.display = 'none';
    });
  }

  function showOrderReadyModal(ticket, counterId) {
    const modal = document.getElementById('ready-modal');
    if (!modal) return;
    document.getElementById('modal-ticket-num').textContent = ticket.ticketNumber;
    document.getElementById('modal-counter-name').textContent = ticket.counterName || counterId;
    modal.style.display = 'flex';
  }

  // ==========================================================================
  // MASTER RENDER
  // ==========================================================================
  function renderAllViews() {
    if (state.serverQueues) {
      const c = state.serverQueues.counters;
      document.getElementById('badge-hot-meals').textContent = c['hot-meals']?.activeCount || 0;
      document.getElementById('badge-snacks-drinks').textContent = c['snacks-drinks']?.activeCount || 0;
      document.getElementById('badge-express-deli').textContent = c['express-deli']?.activeCount || 0;

      document.getElementById('header-total-waiting').textContent = state.serverQueues.totalActive;
      document.getElementById('header-total-served').textContent = state.serverQueues.totalServed;
    }
    renderStudentTracker();
    if (state.activeTab === 'staff') renderStaffDashboard();
    else if (state.activeTab === 'tv') renderTVDisplay();
  }
});
