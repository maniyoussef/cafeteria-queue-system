/**
 * CampusBite FIFO Queue System — Client Application
 */

document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) window.lucide.createIcons();

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
    myTicket: null,
    serverQueues: null,
    networkIPs: [],
    authToken: localStorage.getItem('campusbite_auth_token') || null,
    authUser: savedUser
  };

  const SERVER_URL = window.SERVER_URL || window.location.origin;

  function createEventStreamSocket(baseUrl) {
    const handlers = {};
    const lifecycleEvents = ['connect', 'disconnect', 'connect_error'];

    let source = null;
    let connected = false;

    function fire(event, payload) {
      (handlers[event] || []).forEach(fn => fn(payload));
    }

    function attach(event) {
      if (lifecycleEvents.includes(event) || !source) return;
      source.addEventListener(event, (e) => {
        try {
          fire(event, JSON.parse(e.data));
        } catch {
          fire(event, e.data);
        }
      });
    }

    function open() {
      source = new EventSource(`${baseUrl}/api/events`);
      source.onopen = () => {
        connected = true;
        fire('connect');
      };
      source.onerror = () => {
        if (connected) {
          connected = false;
          fire('disconnect', 'server unreachable');
        } else {
          fire('connect_error', new Error('Server unreachable'));
        }
      };

      Object.keys(handlers).forEach(attach);
    }

    open();

    return {
      on(event, fn) {
        if (!handlers[event]) {
          handlers[event] = [];
          attach(event);
        }
        handlers[event].push(fn);
      },
      emit() {},
      connect() {
        if (source && source.readyState === EventSource.CLOSED) {
          window.location.reload();
        }
      }
    };
  }

  const socket = typeof window.io === 'function'
    ? io(SERVER_URL, {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 3000,
        reconnectionAttempts: Infinity
      })
    : createEventStreamSocket(SERVER_URL);

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

    const isMatch =
      currentTicket.id === ticketId ||
      currentTicket.ticketNumber === ticketId ||
      (completedTicket && (currentTicket.id === completedTicket.id || currentTicket.ticketNumber === completedTicket.ticketNumber));

    if (isMatch) {
      const isNoShow = action === 'no_show' || completedTicket?.status === 'no_show';
      state.myTicket.status = isNoShow ? 'no_show' : 'completed';
      state.myTicket.finishedAt = new Date().toISOString();
      saveMyTicket(state.myTicket);

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

  fetchNetworkStatus();
  initAuthService();
  initNavigation();
  initStudentView();
  initStaffView();
  initTestBenchView();
  initModals();
  initOfflineOverlay();

  switchTab(state.activeTab);

  function initAuthService() {
    const authForm = document.getElementById('auth-login-form');
    if (authForm) {
      authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('auth-username').value.trim();
        const password = document.getElementById('auth-password').value;
        await handleLogin(username, password);
      });
    }

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

    if (state.authToken) {
      fetch(`${SERVER_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${state.authToken}` }
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
      const res = await fetch(`${SERVER_URL}/api/auth/login`, {
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
      fetch(`${SERVER_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.authToken}`
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
    const pill = document.getElementById('user-profile-pill');
    const nameEl = document.getElementById('user-display-name');
    const roleTag = document.getElementById('user-role-tag');
    const authActionBtn = document.getElementById('btn-header-auth-action');
    const roleIcon = document.getElementById('user-role-icon');
    const headerStats = document.getElementById('header-stats');
    const sidebar = document.getElementById('sidebar');

    if (pill && nameEl && roleTag && authActionBtn) {
      pill.style.display = 'inline-flex';
      nameEl.textContent = user.name;
      roleTag.textContent = user.role === 'staff' ? 'Staff Server' : 'Client';
      roleTag.className = `user-role-tag ${user.role}`;
      authActionBtn.textContent = 'Sign Out';
      authActionBtn.style.display = 'inline-flex';
      if (roleIcon) {
        roleIcon.setAttribute('data-lucide', user.role === 'staff' ? 'chef-hat' : 'user');
      }
    }

    if (headerStats) headerStats.style.display = 'flex';
    if (sidebar) sidebar.style.display = 'flex';

    const tabAuth = document.getElementById('tab-auth');
    const tabStudent = document.getElementById('tab-student');
    const tabStaff = document.getElementById('tab-staff');
    const tabTv = document.getElementById('tab-tv');
    const tabBench = document.getElementById('tab-testbench');

    if (tabAuth) tabAuth.style.display = 'none';

    if (user.role === 'student') {
      if (tabStudent) tabStudent.style.display = 'inline-flex';
      if (tabStaff) tabStaff.style.display = 'none';
      if (tabTv) tabTv.style.display = 'inline-flex';
      if (tabBench) tabBench.style.display = 'none';

      state.myTicket = loadMyTicket();
      renderStudentTracker();

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
      if (tabStudent) tabStudent.style.display = 'none';
      if (tabStaff) tabStaff.style.display = 'inline-flex';
      if (tabTv) tabTv.style.display = 'inline-flex';
      if (tabBench) tabBench.style.display = 'inline-flex';

      state.myTicket = null;
      const authHint = document.getElementById('student-auth-hint');
      if (authHint) authHint.style.display = 'none';
    }

    if (window.lucide) window.lucide.createIcons();
  }

  function applyLoggedOutState() {
    const pill = document.getElementById('user-profile-pill');
    const authActionBtn = document.getElementById('btn-header-auth-action');
    const headerStats = document.getElementById('header-stats');
    const sidebar = document.getElementById('sidebar');

    if (pill) pill.style.display = 'none';
    if (authActionBtn) authActionBtn.style.display = 'none';
    if (headerStats) headerStats.style.display = 'none';
    if (sidebar) sidebar.style.display = 'none';

    state.myTicket = loadMyTicket();

    const tabAuth = document.getElementById('tab-auth');
    const tabStudent = document.getElementById('tab-student');
    const tabStaff = document.getElementById('tab-staff');
    const tabTv = document.getElementById('tab-tv');
    const tabBench = document.getElementById('tab-testbench');

    if (tabAuth) tabAuth.style.display = 'none';
    if (tabStudent) tabStudent.style.display = 'none';
    if (tabStaff) tabStaff.style.display = 'none';
    if (tabTv) tabTv.style.display = 'none';
    if (tabBench) tabBench.style.display = 'none';

    const authHint = document.getElementById('student-auth-hint');
    if (authHint) authHint.style.display = 'none';

    if (window.lucide) window.lucide.createIcons();
  }

  function initNavigation() {
    document.querySelectorAll('.sidebar-link, .nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

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
    if (!state.authUser) {
      tab = 'auth';
    } else if (state.authUser.role === 'student') {
      if (tab === 'staff' || tab === 'testbench' || tab === 'auth') tab = 'student';
    } else if (state.authUser.role === 'staff') {
      if (tab === 'student' || tab === 'auth') tab = 'staff';
    }

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
    const pageTitle = document.getElementById('page-title');
    if (pageTitle) pageTitle.textContent = pageTitles[tab] || 'CampusBite';

    renderAllViews();
  }

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

  function showConfirm(title, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      const titleEl = document.getElementById('confirm-title');
      const messageEl = document.getElementById('confirm-message');
      const okBtn = document.getElementById('confirm-ok-btn');
      const cancelBtn = document.getElementById('confirm-cancel-btn');

      if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
        resolve(false);
        return;
      }

      titleEl.textContent = title;
      messageEl.textContent = message;
      modal.style.display = 'flex';

      function cleanup(result) {
        modal.style.display = 'none';
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        resolve(result);
      }

      function onOk() {
        cleanup(true);
      }

      function onCancel() {
        cleanup(false);
      }

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
    });
  }

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
      if (retrySecondsLeft <= 0) {
        retrySecondsLeft = 3;
        socket.connect();
      }
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

  function updateConnectionUI(isConnected) {
    const dots = document.querySelectorAll('.indicator-dot');
    const labels = document.querySelectorAll('.status-label');

    dots.forEach(d => {
      d.className = `indicator-dot ${isConnected ? 'connected' : 'disconnected'}`;
    });

    labels.forEach(l => {
      if (l) l.textContent = isConnected ? 'Connected' : 'Reconnecting…';
    });

    const statusText = document.getElementById('network-status-text');
    if (statusText) statusText.textContent = isConnected ? 'Connected to server' : 'Connecting…';
  }

  async function fetchNetworkStatus() {
    try {
      const res = await fetch(`${SERVER_URL}/api/status`);
      const data = await res.json();
      state.networkIPs = data.networkIPs || [];
      renderNetworkInfo();
    } catch (e) {
      // silent fallback
    }
  }

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
    } catch (e) {
      // silent fallback
    }
  }

  const selectedItems = new Set();

  function initStudentView() {
    const chipsContainer = document.getElementById('item-chips-container');
    if (chipsContainer) {
      chipsContainer.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const item = chip.dataset.item;
        if (selectedItems.has(item)) {
          selectedItems.delete(item);
          chip.classList.remove('selected');
        } else {
          selectedItems.add(item);
          chip.classList.add('selected');
        }
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

        if (!items.length && !notes) {
          items.push('Standard Meal Deal');
        }

        const btn = document.getElementById('btn-join');
        try {
          btn.disabled = true;
          btn.innerHTML = `<i data-lucide="loader-2"></i> Joining…`;
          if (window.lucide) window.lucide.createIcons();

          const response = await fetch(`${SERVER_URL}/api/queue/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ counterId, studentName, studentId, items, notes })
          });

          const data = await response.json();

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

    const cancelBtn = document.getElementById('btn-cancel-ticket');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        if (!state.myTicket) return;

        const confirmed = await showConfirm('Leave queue?', 'You will lose your position in line. This cannot be undone.');
        if (!confirmed) return;

        try {
          await fetch(`${SERVER_URL}/api/queue/leave`, {
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
    }

    const newTicketBtn = document.getElementById('btn-new-ticket');
    if (newTicketBtn) {
      newTicketBtn.addEventListener('click', () => {
        clearMyTicket();
        renderStudentTracker();
      });
    }

    const soundToggle = document.getElementById('btn-sound-toggle');
    if (soundToggle) {
      soundToggle.addEventListener('click', () => {
        state.soundEnabled = !state.soundEnabled;
        const soundText = document.getElementById('sound-text');
        const soundIcon = document.getElementById('sound-icon');
        if (soundText) soundText.textContent = state.soundEnabled ? 'Sound On' : 'Sound Off';
        if (soundIcon) {
          soundIcon.setAttribute('data-lucide', state.soundEnabled ? 'volume-2' : 'volume-x');
        }
        if (window.lucide) window.lucide.createIcons();
      });
    }
  }

  function renderStudentTracker() {
    const joinCard = document.getElementById('student-join-card');
    const trackerCard = document.getElementById('student-tracker-card');
    const emptyState = document.getElementById('ticket-empty-state');
    const activeDisplay = document.getElementById('ticket-active-display');
    const liveBadge = document.getElementById('ticket-live-badge');
    const panelDesc = document.getElementById('ticket-panel-desc');

    if (joinCard) joinCard.style.display = 'block';
    if (trackerCard) trackerCard.style.display = 'block';

    if (!state.myTicket) {
      if (emptyState) emptyState.style.display = 'flex';
      if (activeDisplay) activeDisplay.style.display = 'none';
      if (liveBadge) liveBadge.style.display = 'none';
      if (panelDesc) {
        panelDesc.style.display = 'block';
        panelDesc.textContent = 'Your live ticket will appear here once you join a counter.';
      }
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (activeDisplay) activeDisplay.style.display = 'block';
    if (liveBadge) liveBadge.style.display = 'inline-flex';
    if (panelDesc) panelDesc.style.display = 'none';

    const t = state.myTicket;

    const counterNameEl = document.getElementById('ticket-counter-name');
    const ticketNumberEl = document.getElementById('ticket-number-display');
    const studentNameEl = document.getElementById('ticket-student-name');
    const itemsListEl = document.getElementById('ticket-items-list');
    const joinedTimeEl = document.getElementById('ticket-joined-time');
    const statusPill = document.getElementById('ticket-status-pill');
    const statusText = document.getElementById('ticket-status-text');
    const positionEl = document.getElementById('ticket-position');
    const waitEstEl = document.getElementById('ticket-wait-est');
    const totalWaitingEl = document.getElementById('ticket-total-waiting');
    const cancelBtn = document.getElementById('btn-cancel-ticket');
    const newTicketBtn = document.getElementById('btn-new-ticket');
    const readyCallout = document.getElementById('ready-callout');
    const expiredBanner = document.getElementById('ticket-expired-banner');

    if (counterNameEl) counterNameEl.textContent = t.counterName || 'Cafeteria Counter';
    if (ticketNumberEl) ticketNumberEl.textContent = t.ticketNumber;
    if (studentNameEl) studentNameEl.textContent = t.studentName;
    if (itemsListEl) itemsListEl.textContent = t.items && t.items.length ? t.items.join(', ') : 'Standard Meal';
    if (joinedTimeEl) joinedTimeEl.textContent = new Date(t.timestampMs || Date.now()).toLocaleTimeString();

    if (expiredBanner) expiredBanner.style.display = 'none';
    if (readyCallout) readyCallout.style.display = 'none';

    const counter = state.serverQueues?.counters?.[t.counterId];

    if (counter?.servingTicket && (counter.servingTicket.id === t.id || counter.servingTicket.ticketNumber === t.ticketNumber)) {
      t.status = 'now_serving';
      if (statusPill) statusPill.className = 'ticket-status-pill status-serving';
      if (statusText) statusText.innerHTML = '<i data-lucide="bell"></i> Now Serving';
      if (positionEl) positionEl.textContent = 'NOW';
      if (waitEstEl) waitEstEl.textContent = '0 min';
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (newTicketBtn) newTicketBtn.style.display = 'block';
      if (readyCallout) {
        readyCallout.style.display = 'flex';
        const readyCounterName = document.getElementById('ready-counter-name');
        const readyTicketNum = document.getElementById('ready-ticket-num');
        if (readyCounterName) readyCounterName.textContent = t.counterName;
        if (readyTicketNum) readyTicketNum.textContent = t.ticketNumber;
      }
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    const activeQueue = counter?.activeQueue || [];
    const foundIdx = activeQueue.findIndex(item => item.id === t.id || item.ticketNumber === t.ticketNumber);

    if (foundIdx !== -1) {
      const q = activeQueue[foundIdx];
      t.status = 'in_queue';
      if (statusPill) statusPill.className = 'ticket-status-pill status-in-queue';
      if (statusText) statusText.innerHTML = '<i data-lucide="clock"></i> In Queue';
      if (positionEl) positionEl.textContent = `#${q.position}`;
      if (totalWaitingEl) totalWaitingEl.textContent = `of ${activeQueue.length} in queue`;
      if (waitEstEl) waitEstEl.textContent = `~${q.estimatedWaitMinutes} min`;
      if (readyCallout) readyCallout.style.display = 'none';
      if (cancelBtn) cancelBtn.style.display = 'block';
      if (newTicketBtn) newTicketBtn.style.display = 'none';
    } else {
      if (cancelBtn) cancelBtn.style.display = 'none';
      if (newTicketBtn) newTicketBtn.style.display = 'block';

      if (t.status === 'no_show') {
        if (statusPill) statusPill.className = 'ticket-status-pill status-expired';
        if (statusText) statusText.innerHTML = '<i data-lucide="user-x"></i> No-Show / Missed';
        if (positionEl) positionEl.textContent = 'MISSED';
        if (waitEstEl) waitEstEl.textContent = '0 min';
        if (ticketNumberEl) ticketNumberEl.classList.add('strikethrough');
        if (expiredBanner) {
          expiredBanner.style.display = 'flex';
          const expDesc = expiredBanner.querySelector('.alert-body p');
          if (expDesc) expDesc.textContent = 'Your ticket was marked as no-show by staff. Please proceed to the counter or join a new line.';
        }
      } else {
        t.status = 'completed';
        if (statusPill) statusPill.className = 'ticket-status-pill status-completed';
        if (statusText) statusText.innerHTML = '<i data-lucide="check-check"></i> Completed & Handed Over';
        if (positionEl) positionEl.textContent = 'SERVED';
        if (waitEstEl) waitEstEl.textContent = '0 min';
      }
    }

    if (window.lucide) window.lucide.createIcons();
  }

  function initStaffView() {
    document.querySelectorAll('#staff-counter-tabs .tab-btn').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('#staff-counter-tabs .tab-btn').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.staffCounterId = tab.dataset.counter;
        renderStaffDashboard();
      });
    });

    const serveBtn = document.getElementById('btn-serve-next');
    if (serveBtn) serveBtn.addEventListener('click', serveNextStudent);

    window.addEventListener('keydown', (e) => {
      if (state.activeTab === 'staff' && e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
        e.preventDefault();
        serveNextStudent();
      }
    });

    const completeBtn = document.getElementById('btn-complete-serving');
    if (completeBtn) completeBtn.addEventListener('click', () => completeServing('complete'));

    const recallBtn = document.getElementById('btn-recall-serving');
    if (recallBtn) {
      recallBtn.addEventListener('click', () => {
        if (!state.serverQueues) return;
        const counter = state.serverQueues.counters[state.staffCounterId];
        if (counter?.servingTicket) {
          socket.emit('staff:recall', { ticket: counter.servingTicket });
          playAudioChime();
        }
      });
    }

    const noShowBtn = document.getElementById('btn-noshow-serving');
    if (noShowBtn) noShowBtn.addEventListener('click', () => completeServing('no_show'));
  }

  async function serveNextStudent() {
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {})
      };

      const res = await fetch(`${SERVER_URL}/api/staff/serve-next`, {
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
      const headers = {
        'Content-Type': 'application/json',
        ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {})
      };

      const res = await fetch(`${SERVER_URL}/api/staff/complete`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          counterId: state.staffCounterId,
          ticketId: counter.servingTicket.id,
          action
        })
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

    const hotCount = document.getElementById('staff-count-hm');
    const sdCount = document.getElementById('staff-count-sd');
    const exCount = document.getElementById('staff-count-ex');
    const totalWaitingEl = document.getElementById('stat-total-waiting');
    const totalServedEl = document.getElementById('stat-total-served');
    const avgWaitEl = document.getElementById('stat-avg-wait');

    if (hotCount) hotCount.textContent = data.counters['hot-meals']?.activeCount || 0;
    if (sdCount) sdCount.textContent = data.counters['snacks-drinks']?.activeCount || 0;
    if (exCount) exCount.textContent = data.counters['express-deli']?.activeCount || 0;
    if (totalWaitingEl) totalWaitingEl.textContent = data.totalActive;
    if (totalServedEl) totalServedEl.textContent = data.totalServed;
    if (avgWaitEl) avgWaitEl.textContent = `${counter?.avgWaitMinutes || 0}m`;

    if (!counter) return;

    const titleEl = document.getElementById('staff-current-counter-title');
    const queueCountBadge = document.getElementById('staff-queue-count-badge');
    if (titleEl) titleEl.textContent = `${counter.name} — Controls`;
    if (queueCountBadge) queueCountBadge.textContent = `${counter.activeCount} waiting`;

    const emptyState = document.getElementById('serving-empty-state');
    const activeContent = document.getElementById('serving-active-content');

    if (counter.servingTicket) {
      if (emptyState) emptyState.style.display = 'none';
      if (activeContent) activeContent.style.display = 'block';

      const t = counter.servingTicket;
      const staffServingNumber = document.getElementById('staff-serving-number');
      const staffServingName = document.getElementById('staff-serving-name');
      const staffServingItems = document.getElementById('staff-serving-items');
      const staffServingNotes = document.getElementById('staff-serving-notes');

      if (staffServingNumber) staffServingNumber.textContent = t.ticketNumber;
      if (staffServingName) staffServingName.textContent = t.studentName + (t.studentId ? ` (${t.studentId})` : '');
      if (staffServingItems) {
        staffServingItems.innerHTML = (t.items || []).map(item => `<span class="item-badge">${item}</span>`).join('');
      }
      if (staffServingNotes) {
        staffServingNotes.textContent = t.notes ? `"${t.notes}"` : '';
      }
    } else {
      if (emptyState) emptyState.style.display = 'flex';
      if (activeContent) activeContent.style.display = 'none';
    }

    const queueList = document.getElementById('staff-queue-list');
    if (!counter.activeQueue || counter.activeQueue.length === 0) {
      if (queueList) {
        queueList.innerHTML = `<div class="empty-state"><i data-lucide="check-circle-2"></i><p>No one is waiting. A quiet moment.</p></div>`;
      }
    } else {
      if (queueList) {
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
    }

    if (window.lucide) window.lucide.createIcons();
  }

  let lastTvBoardSignature = null;

  const TV_COUNTER_META = {
    'hot-meals': { icon: 'flame', short: 'Hot Meals' },
    'snacks-drinks': { icon: 'coffee', short: 'Snacks & Drinks' },
    'express-deli': { icon: 'zap', short: 'Express Deli' }
  };

  function updateTvClock() {
    const clockEl = document.getElementById('tv-clock-display');
    if (clockEl) clockEl.textContent = new Date().toLocaleTimeString();
  }

  function getTvBoardSignature(queues) {
    if (!queues?.counters) return '';
    return Object.values(queues.counters)
      .map(c => {
        const serving = c.servingTicket;
        const next = (c.activeQueue || []).slice(0, 5).map(t => t.ticketNumber).join(',');
        return `${c.id}:${serving?.ticketNumber || ''}:${serving?.studentName || ''}:${c.activeQueue?.length || 0}:${next}`;
      })
      .join('|');
  }

  function buildTvCounterCard(counter) {
    const meta = TV_COUNTER_META[counter.id] || { icon: 'utensils', short: counter.name };
    const serving = counter.servingTicket;
    const queue = counter.activeQueue || [];
    const next = queue.slice(0, 5);
    const isActive = Boolean(serving);

    return `
      <article class="tv-counter-card${isActive ? ' is-serving' : ''}" data-counter="${counter.id}">
        <header class="tv-counter-header">
          <div class="tv-counter-icon" aria-hidden="true">
            <i data-lucide="${meta.icon}"></i>
          </div>
          <div class="tv-counter-heading">
            <span class="tv-counter-title">${meta.short}</span>
            <span class="tv-counter-subtitle">${counter.name}</span>
          </div>
          <span class="tv-queue-count" title="Waiting in line">${queue.length}</span>
        </header>

        <div class="tv-now-serving-box">
          <div class="tv-serving-label">
            <i data-lucide="bell"></i>
            Now Serving
          </div>
          <div class="tv-serving-num${serving ? '' : ' is-idle'}">${serving ? serving.ticketNumber : 'NONE'}</div>
          <div class="tv-serving-name${serving ? '' : ' is-idle'}">${serving ? serving.studentName : 'Counter is free'}</div>
        </div>

        <div class="tv-up-next-list">
          <h4>
            <i data-lucide="list-ordered"></i>
            Up Next
            <span class="tv-up-next-count">${queue.length}</span>
          </h4>
          <div class="tv-next-chips">
            ${next.length
              ? next.map(t => `<span class="tv-next-chip">${t.ticketNumber}</span>`).join('')
              : '<span class="tv-next-empty">No tickets waiting</span>'}
          </div>
        </div>
      </article>`;
  }

  function renderTVDisplay(force = false) {
    updateTvClock();

    const grid = document.getElementById('tv-counters-grid');
    if (!grid) return;

    if (!state.serverQueues?.counters) {
      if (grid.childElementCount === 0) {
        const placeholders = [
          { id: 'hot-meals', name: 'Hot Meals Counter', activeQueue: [], servingTicket: null },
          { id: 'snacks-drinks', name: 'Snacks & Drinks Counter', activeQueue: [], servingTicket: null },
          { id: 'express-deli', name: 'Express Deli & Salad Bar', activeQueue: [], servingTicket: null }
        ];
        grid.innerHTML = placeholders.map(buildTvCounterCard).join('');
        if (window.lucide) window.lucide.createIcons();
      }
      return;
    }

    const signature = getTvBoardSignature(state.serverQueues);
    if (!force && signature === lastTvBoardSignature && grid.childElementCount > 0) return;
    lastTvBoardSignature = signature;

    grid.innerHTML = Object.values(state.serverQueues.counters).map(buildTvCounterCard).join('');
    if (window.lucide) window.lucide.createIcons();
  }

  setInterval(() => {
    if (state.activeTab === 'tv') updateTvClock();
  }, 1000);

  async function fetchQueueState() {
    try {
      const res = await fetch(`${SERVER_URL}/api/queues`);
      const data = await res.json();
      if (data?.counters) {
        state.serverQueues = data;
        if (state.activeTab === 'tv') renderTVDisplay(true);
        else renderAllViews();
      }
    } catch (e) {
      // socket will retry
    }
  }

  function initTestBenchView() {
    const runBtn = document.getElementById('btn-run-concurrency-test');
    if (runBtn) {
      runBtn.addEventListener('click', async () => {
        const counterId = document.getElementById('sim-counter-select').value;
        const count = parseInt(document.getElementById('sim-count-select').value, 10);

        const benchLog = document.getElementById('bench-log-container');
        const appendLog = (msg, type = 'info') => {
          if (!benchLog) return;
          const p = document.createElement('p');
          p.className = `log-entry log-${type}`;
          p.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
          benchLog.prepend(p);
        };

        appendLog(`Launching ${count} parallel requests to '${counterId}'…`, 'info');

        try {
          runBtn.disabled = true;
          const res = await fetch(`${SERVER_URL}/api/test/concurrent-join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ counterId, count })
          });

          const data = await res.json();
          runBtn.disabled = false;

          if (data.success) {
            appendLog(`${data.processedCount} requests processed in ${data.durationMs}ms`, 'success');
            data.tickets.forEach(t => appendLog(`  ${t.ticketNumber} > #${t.position} ${t.studentName}`, 'success'));
          } else {
            appendLog(`Failed: ${data.error}`, 'warn');
          }
        } catch (err) {
          runBtn.disabled = false;
          appendLog(`Network error: ${err.message}`, 'warn');
        }
      });
    }

    const resetBtn = document.getElementById('btn-reset-queues');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        const confirmed = await showConfirm('Reset all queues?', 'This will remove all tickets from every counter.');
        if (!confirmed) return;

        try {
          await fetch(`${SERVER_URL}/api/queue/reset`, { method: 'POST' });
          logBench('All queues reset', 'info');
          showToast('All queues have been reset', 'warning');
        } catch (e) {
          logBench('Reset failed: ' + e.message, 'warn');
        }
      });
    }
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

    const primaryUrl = SERVER_URL || window.location.origin;

    let html = `
      <div class="ip-box">
        <span class="label">Cafeteria Server</span>
        <code>${primaryUrl}</code>
      </div>
    `;

    state.networkIPs.forEach(ip => {
      html += `<div class="ip-item"><span class="ip-label">${ip.interface}</span><code class="ip-value">http://${ip.address}:${window.location.port || '3000'}</code></div>`;
    });

    list.innerHTML = html;

    if (qrText) qrText.textContent = primaryUrl;

    if (qrContainer && window.QRCode) {
      qrContainer.innerHTML = '';
      new window.QRCode(qrContainer, {
        text: primaryUrl,
        width: 120,
        height: 120,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.H
      });
    }
  }

  function initModals() {
    const modalDismissBtn = document.getElementById('btn-modal-dismiss');
    if (modalDismissBtn) {
      modalDismissBtn.addEventListener('click', () => {
        const readyModal = document.getElementById('ready-modal');
        if (readyModal) readyModal.style.display = 'none';
      });
    }
  }

  function showOrderReadyModal(ticket, counterId) {
    const modal = document.getElementById('ready-modal');
    if (!modal) return;

    const modalTicketNum = document.getElementById('modal-ticket-num');
    const modalCounterName = document.getElementById('modal-counter-name');

    if (modalTicketNum) modalTicketNum.textContent = ticket.ticketNumber;
    if (modalCounterName) modalCounterName.textContent = ticket.counterName || counterId;

    modal.style.display = 'flex';
  }

  function renderAllViews() {
    if (state.serverQueues) {
      const c = state.serverQueues.counters;

      const badgeHot = document.getElementById('badge-hot-meals');
      const badgeSnacks = document.getElementById('badge-snacks-drinks');
      const badgeExpress = document.getElementById('badge-express-deli');

      if (badgeHot) badgeHot.textContent = c['hot-meals']?.activeCount || 0;
      if (badgeSnacks) badgeSnacks.textContent = c['snacks-drinks']?.activeCount || 0;
      if (badgeExpress) badgeExpress.textContent = c['express-deli']?.activeCount || 0;

      const totalWaiting = document.getElementById('header-total-waiting');
      const totalServed = document.getElementById('header-total-served');

      if (totalWaiting) totalWaiting.textContent = state.serverQueues.totalActive;
      if (totalServed) totalServed.textContent = state.serverQueues.totalServed;
    }

    renderStudentTracker();

    if (state.activeTab === 'staff') {
      renderStaffDashboard();
    } else if (state.activeTab === 'tv') {
      renderTVDisplay();
    }
  }

  fetchQueueState();
});
