/**
 * CampusBite FIFO Queue System — Client JavaScript
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // Application State
  const state = {
    connected: false,
    soundEnabled: true,
    activeTab: 'student',
    staffCounterId: 'hot-meals',
    myTicket: JSON.parse(localStorage.getItem('myCafeteriaTicket') || 'null'),
    serverQueues: null,
    networkIPs: []
  };

  // Socket.IO Connection
  const socket = io();

  // Socket Event Listeners
  socket.on('connect', () => {
    state.connected = true;
    updateSocketStatusUI(true);
  });

  socket.on('disconnect', () => {
    state.connected = false;
    updateSocketStatusUI(false);
  });

  socket.on('queue:updated', (data) => {
    state.serverQueues = data;
    renderAllViews();
  });

  socket.on('ticket:called', (payload) => {
    const { ticket, counterId } = payload;
    
    // Play sound chime if sound enabled
    if (state.soundEnabled) {
      playAudioChime();
    }

    // Check if this student's ticket was called
    if (state.myTicket && (state.myTicket.id === ticket.id || state.myTicket.ticketNumber === ticket.ticketNumber)) {
      state.myTicket.status = 'now_serving';
      saveMyTicket(state.myTicket);
      showOrderReadyModal(ticket, counterId);
    }
  });

  // Fetch initial network status & IPs
  fetchNetworkStatus();

  // Initialize UI Event Handlers
  initTabNavigation();
  initStudentView();
  initStaffView();
  initTestBenchView();
  initReadyModal();

  /* ==========================================================================
     AUDIO SYNTHESIZER (Web Audio API Chime)
     ========================================================================== */
  function playAudioChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

      // Tone 1: C5 (523.25 Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, ctx.currentTime);
      gain1.gain.setValueAtTime(0.3, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);

      // Tone 2: E5 (659.25 Hz) - played slightly delayed
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15);
      gain2.gain.setValueAtTime(0.3, ctx.currentTime + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);

      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.5);
      osc2.start(ctx.currentTime + 0.15);
      osc2.stop(ctx.currentTime + 0.8);
    } catch (e) {
      console.warn('Audio chime error:', e);
    }
  }

  /* ==========================================================================
     NETWORK STATUS & SOCKET UI
     ========================================================================== */
  function updateSocketStatusUI(isConnected) {
    const badge = document.getElementById('socket-status');
    const label = badge.querySelector('.status-label');
    const text = document.getElementById('network-status-text');

    if (isConnected) {
      badge.style.borderColor = 'var(--success)';
      label.textContent = 'Live Sync (Socket.IO)';
      label.style.color = 'var(--success)';
      if (text) text.textContent = 'Connected to VM1 Server';
    } else {
      badge.style.borderColor = 'var(--danger)';
      label.textContent = 'Reconnecting...';
      label.style.color = 'var(--danger)';
      if (text) text.textContent = 'Connecting to server...';
    }
  }

  async function fetchNetworkStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      state.networkIPs = data.networkIPs || [];
      renderNetworkInfo();
    } catch (e) {
      console.warn('Network fetch error:', e);
    }
  }

  /* ==========================================================================
     NAVIGATION & TABS
     ========================================================================== */
  function initTabNavigation() {
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        navButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        document.querySelectorAll('.view-panel').forEach(panel => {
          panel.classList.remove('active');
        });
        document.getElementById(`view-${tab}`).classList.add('active');

        state.activeTab = tab;
        renderAllViews();
      });
    });
  }

  /* ==========================================================================
     VIEW 1: STUDENT VIEW LOGIC
     ========================================================================== */
  function initStudentView() {
    // Quick Item Chip selector
    const selectedItems = new Set();
    const container = document.getElementById('item-chips-container');
    
    if (container) {
      container.addEventListener('click', (e) => {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        const itemName = chip.dataset.item;

        if (selectedItems.has(itemName)) {
          selectedItems.delete(itemName);
          chip.classList.remove('selected');
        } else {
          selectedItems.add(itemName);
          chip.classList.add('selected');
        }
      });
    }

    // Join Form Submit
    const joinForm = document.getElementById('join-queue-form');
    if (joinForm) {
      joinForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const counterId = joinForm.querySelector('input[name="counterId"]:checked').value;
        const studentName = document.getElementById('studentName').value.trim();
        const studentId = document.getElementById('studentId').value.trim();
        const notes = document.getElementById('orderNotes').value.trim();
        const items = Array.from(selectedItems);

        if (!items.length && !notes) {
          items.push('Standard Meal Deal');
        }

        try {
          const btn = document.getElementById('btn-join');
          btn.disabled = true;
          btn.innerHTML = `<i data-lucide="loader-2" class="spin"></i> Joining Queue...`;

          const response = await fetch('/api/queue/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ counterId, studentName, studentId, items, notes })
          });

          const data = await response.json();
          btn.disabled = false;
          btn.innerHTML = `<i data-lucide="ticket"></i> Join Queue Now (Get FIFO Ticket)`;
          if (window.lucide) window.lucide.createIcons();

          if (data.success) {
            saveMyTicket(data.ticket);
            renderStudentTracker();
          } else {
            alert('Error joining queue: ' + data.error);
          }
        } catch (err) {
          alert('Network connection error: ' + err.message);
        }
      });
    }

    // Cancel Ticket Button
    const cancelBtn = document.getElementById('btn-cancel-ticket');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', async () => {
        if (!state.myTicket) return;
        if (!confirm('Are you sure you want to cancel your queue ticket?')) return;

        try {
          await fetch('/api/queue/leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ counterId: state.myTicket.counterId, ticketId: state.myTicket.id })
          });
          clearMyTicket();
          renderStudentTracker();
        } catch (err) {
          alert('Error cancelling ticket: ' + err.message);
        }
      });
    }

    // Join New Ticket Button (After completed)
    const newBtn = document.getElementById('btn-new-ticket');
    if (newBtn) {
      newBtn.addEventListener('click', () => {
        clearMyTicket();
        renderStudentTracker();
      });
    }

    // Sound toggle button
    const soundBtn = document.getElementById('btn-sound-toggle');
    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        state.soundEnabled = !state.soundEnabled;
        document.getElementById('sound-text').textContent = state.soundEnabled ? 'Sound ON' : 'Sound OFF';
        document.getElementById('sound-icon').setAttribute('data-lucide', state.soundEnabled ? 'volume-2' : 'volume-x');
        if (window.lucide) window.lucide.createIcons();
      });
    }
  }

  function saveMyTicket(ticket) {
    state.myTicket = ticket;
    localStorage.setItem('myCafeteriaTicket', JSON.stringify(ticket));
  }

  function clearMyTicket() {
    state.myTicket = null;
    localStorage.removeItem('myCafeteriaTicket');
  }

  function renderStudentTracker() {
    const joinCard = document.getElementById('student-join-card');
    const trackerCard = document.getElementById('student-tracker-card');

    if (!state.myTicket) {
      joinCard.style.display = 'block';
      trackerCard.style.display = 'none';
      return;
    }

    joinCard.style.display = 'block'; // Allow joining multiple or viewing tracker
    trackerCard.style.display = 'block';

    const t = state.myTicket;
    document.getElementById('ticket-counter-name').textContent = t.counterName || 'Cafeteria Counter';
    document.getElementById('ticket-number-display').textContent = t.ticketNumber;
    document.getElementById('ticket-student-name').textContent = t.studentName;
    document.getElementById('ticket-items-list').textContent = (t.items && t.items.length) ? t.items.join(', ') : 'Standard Meal';
    document.getElementById('ticket-joined-time').textContent = new Date(t.timestampMs || Date.now()).toLocaleTimeString();

    // Check updated position in server queue data
    if (state.serverQueues && state.serverQueues.counters[t.counterId]) {
      const counter = state.serverQueues.counters[t.counterId];
      
      // Check if ticket is currently serving
      if (counter.servingTicket && (counter.servingTicket.id === t.id || counter.servingTicket.ticketNumber === t.ticketNumber)) {
        t.status = 'now_serving';
        document.getElementById('ticket-status-pill').className = 'ticket-status-pill status-serving';
        document.getElementById('ticket-status-text').textContent = 'NOW SERVING! GO TO COUNTER';
        document.getElementById('ticket-position').textContent = 'NOW';
        document.getElementById('ticket-position').style.color = 'var(--success)';
        document.getElementById('ticket-wait-est').textContent = '0 min';
        
        document.getElementById('ready-callout').style.display = 'block';
        document.getElementById('ready-counter-name').textContent = t.counterName;
        document.getElementById('ready-ticket-num').textContent = t.ticketNumber;
        document.getElementById('btn-cancel-ticket').style.display = 'none';
        document.getElementById('btn-new-ticket').style.display = 'block';
        return;
      }

      // Check position in active queue
      const activeQueue = counter.activeQueue || [];
      const foundIdx = activeQueue.findIndex(item => item.id === t.id || item.ticketNumber === t.ticketNumber);

      if (foundIdx !== -1) {
        const itemInQueue = activeQueue[foundIdx];
        t.status = 'in_queue';
        document.getElementById('ticket-status-pill').className = 'ticket-status-pill status-in-queue';
        document.getElementById('ticket-status-text').textContent = 'IN QUEUE';
        document.getElementById('ticket-position').textContent = `#${itemInQueue.position}`;
        document.getElementById('ticket-position').style.color = 'var(--warning)';
        document.getElementById('ticket-total-waiting').textContent = `of ${activeQueue.length} waiting`;
        document.getElementById('ticket-wait-est').textContent = `~${itemInQueue.estimatedWaitMinutes} min`;
        document.getElementById('ready-callout').style.display = 'none';
        document.getElementById('btn-cancel-ticket').style.display = 'block';
        document.getElementById('btn-new-ticket').style.display = 'none';
      } else if (t.status !== 'now_serving') {
        // Ticket finished or removed
        document.getElementById('ticket-status-pill').className = 'ticket-status-pill';
        document.getElementById('ticket-status-text').textContent = 'COMPLETED / FINISHED';
        document.getElementById('ticket-position').textContent = 'DONE';
        document.getElementById('btn-cancel-ticket').style.display = 'none';
        document.getElementById('btn-new-ticket').style.display = 'block';
      }
    }
  }

  /* ==========================================================================
     VIEW 2: STAFF DASHBOARD LOGIC
     ========================================================================== */
  function initStaffView() {
    // Segmented tab switching for staff
    const tabs = document.querySelectorAll('#staff-counter-tabs .segment');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.staffCounterId = tab.dataset.counter;
        renderStaffDashboard();
      });
    });

    // SERVE NEXT Button
    const serveNextBtn = document.getElementById('btn-serve-next');
    if (serveNextBtn) {
      serveNextBtn.addEventListener('click', () => serveNextStudent());
    }

    // Keyboard shortcut: SPACE bar to serve next when in staff tab
    window.addEventListener('keydown', (e) => {
      if (state.activeTab === 'staff' && e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        serveNextStudent();
      }
    });

    // Complete Current Serving Ticket
    const completeBtn = document.getElementById('btn-complete-serving');
    if (completeBtn) {
      completeBtn.addEventListener('click', () => completeCurrentServing('complete'));
    }

    // Re-announce ticket
    const recallBtn = document.getElementById('btn-recall-serving');
    if (recallBtn) {
      recallBtn.addEventListener('click', () => {
        if (!state.serverQueues) return;
        const counter = state.serverQueues.counters[state.staffCounterId];
        if (counter && counter.servingTicket) {
          socket.emit('staff:recall', { ticket: counter.servingTicket });
          playAudioChime();
        }
      });
    }

    // Mark No-Show
    const noshowBtn = document.getElementById('btn-noshow-serving');
    if (noshowBtn) {
      noshowBtn.addEventListener('click', () => completeCurrentServing('no_show'));
    }
  }

  async function serveNextStudent() {
    try {
      const res = await fetch('/api/staff/serve-next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counterId: state.staffCounterId })
      });
      const data = await res.json();

      if (!data.success) {
        alert(data.message || 'Could not serve next student.');
      }
    } catch (err) {
      alert('Error serving next student: ' + err.message);
    }
  }

  async function completeCurrentServing(action = 'complete') {
    if (!state.serverQueues) return;
    const counter = state.serverQueues.counters[state.staffCounterId];
    if (!counter || !counter.servingTicket) return;

    try {
      await fetch('/api/staff/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counterId: state.staffCounterId, ticketId: counter.servingTicket.id, action })
      });
    } catch (err) {
      alert('Error completing ticket: ' + err.message);
    }
  }

  function renderStaffDashboard() {
    if (!state.serverQueues) return;

    const data = state.serverQueues;
    const counter = data.counters[state.staffCounterId];

    // Update Counter Badges
    document.getElementById('staff-count-hm').textContent = data.counters['hot-meals']?.activeCount || 0;
    document.getElementById('staff-count-sd').textContent = data.counters['snacks-drinks']?.activeCount || 0;
    document.getElementById('staff-count-ex').textContent = data.counters['express-deli']?.activeCount || 0;

    // Update Stats
    document.getElementById('stat-total-waiting').textContent = data.totalActive;
    document.getElementById('stat-total-served').textContent = data.totalServed;
    document.getElementById('stat-avg-wait').textContent = `${counter?.avgWaitMinutes || 0}m`;

    if (!counter) return;

    document.getElementById('staff-current-counter-title').textContent = `${counter.name} — Staff Controls`;
    document.getElementById('staff-queue-count-badge').textContent = `${counter.activeCount} Students waiting`;

    // Render Currently Serving Box
    const emptyState = document.getElementById('serving-empty-state');
    const activeContent = document.getElementById('serving-active-content');

    if (counter.servingTicket) {
      emptyState.style.display = 'none';
      activeContent.style.display = 'block';

      const t = counter.servingTicket;
      document.getElementById('staff-serving-number').textContent = t.ticketNumber;
      document.getElementById('staff-serving-name').textContent = t.studentName + (t.studentId ? ` (${t.studentId})` : '');
      
      const itemsContainer = document.getElementById('staff-serving-items');
      itemsContainer.innerHTML = (t.items || []).map(i => `<span class="item-badge">${i}</span>`).join('');
      document.getElementById('staff-serving-notes').textContent = t.notes ? `Note: "${t.notes}"` : '';
    } else {
      emptyState.style.display = 'flex';
      activeContent.style.display = 'none';
    }

    // Render Waiting Queue List
    const queueList = document.getElementById('staff-queue-list');
    if (!counter.activeQueue || counter.activeQueue.length === 0) {
      queueList.innerHTML = `
        <div class="empty-state">
          <i data-lucide="check-circle-2"></i>
          <p>Queue is empty! No students waiting at this counter.</p>
        </div>
      `;
    } else {
      queueList.innerHTML = counter.activeQueue.map((item, idx) => `
        <div class="queue-item-card">
          <div class="queue-item-left">
            <div class="line-pos-badge">#${idx + 1}</div>
            <div class="ticket-num-sm">${item.ticketNumber}</div>
            <div class="student-meta">
              <strong>${item.studentName}</strong>
              <span>${(item.items || []).join(', ') || 'Standard Order'} ${item.notes ? `• ${item.notes}` : ''}</span>
            </div>
          </div>
          <div class="queue-item-right">
            <span class="badge-mini">Est. ~${item.estimatedWaitMinutes}m</span>
          </div>
        </div>
      `).join('');
    }

    if (window.lucide) window.lucide.createIcons();
  }

  /* ==========================================================================
     VIEW 3: PUBLIC TV DISPLAY BOARD
     ========================================================================== */
  function renderTVDisplay() {
    if (!state.serverQueues) return;

    // Update Clock
    const clockEl = document.getElementById('tv-clock-display');
    if (clockEl) {
      clockEl.textContent = new Date().toLocaleTimeString();
    }

    const grid = document.getElementById('tv-counters-grid');
    if (!grid) return;

    const counters = Object.values(state.serverQueues.counters);

    grid.innerHTML = counters.map(counter => {
      const serving = counter.servingTicket;
      const nextTickets = counter.activeQueue.slice(0, 4);

      return `
        <div class="tv-counter-card">
          <div class="tv-counter-title">${counter.name}</div>

          <div class="tv-now-serving-box">
            <div class="tv-serving-label">NOW SERVING</div>
            <div class="tv-serving-num">${serving ? serving.ticketNumber : '---'}</div>
            <div class="tv-serving-name">${serving ? serving.studentName : 'Waiting for Staff...'}</div>
          </div>

          <div class="tv-up-next-list">
            <h4>UP NEXT IN LINE (${counter.activeQueue.length})</h4>
            <div class="tv-next-chips">
              ${nextTickets.length > 0 
                ? nextTickets.map(t => `<span class="tv-next-chip">${t.ticketNumber}</span>`).join('')
                : '<span class="subtext">Queue Empty</span>'
              }
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Live TV Clock ticking
  setInterval(() => {
    if (state.activeTab === 'tv') {
      renderTVDisplay();
    }
  }, 1000);

  /* ==========================================================================
     VIEW 4: NETWORK & CONCURRENCY TEST BENCH
     ========================================================================== */
  function initTestBenchView() {
    const runBtn = document.getElementById('btn-run-concurrency-test');
    if (runBtn) {
      runBtn.addEventListener('click', async () => {
        const counterId = document.getElementById('sim-counter-select').value;
        const count = parseInt(document.getElementById('sim-count-select').value, 10);

        logBench(`🚀 Launching ${count} simultaneous join requests to '${counterId}' via Promise.all...`, 'info');

        try {
          runBtn.disabled = true;
          const res = await fetch('/api/test/concurrent-join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ counterId, count })
          });
          const data = await res.json();
          runBtn.disabled = false;

          if (data.success) {
            logBench(`✅ Success! Processed ${data.processedCount} concurrent requests in ${data.durationMs}ms.`, 'success');
            data.tickets.forEach(t => {
              logBench(`   ↳ Assigned Ticket: ${t.ticketNumber} | Position: #${t.position} | Name: ${t.studentName}`, 'success');
            });
          } else {
            logBench(`❌ Test Failed: ${data.error}`, 'warn');
          }
        } catch (err) {
          runBtn.disabled = false;
          logBench(`❌ Network/Request Error: ${err.message}`, 'warn');
        }
      });
    }

    const resetBtn = document.getElementById('btn-reset-queues');
    if (resetBtn) {
      resetBtn.addEventListener('click', async () => {
        if (!confirm('Reset all cafeteria queues?')) return;
        try {
          await fetch('/api/queue/reset', { method: 'POST' });
          logBench('🔄 Reset all cafeteria queues to initial state.', 'info');
        } catch (e) {
          logBench('Error resetting queues: ' + e.message, 'warn');
        }
      });
    }
  }

  function logBench(msg, type = 'info') {
    const container = document.getElementById('bench-log-container');
    if (!container) return;
    const time = new Date().toLocaleTimeString();
    const p = document.createElement('p');
    p.className = `log-entry ${type}`;
    p.textContent = `[${time}] ${msg}`;
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

    let html = `
      <div class="ip-box">
        <span class="label">Current Browser Host</span>
        <code>${primaryUrl}</code>
      </div>
    `;

    state.networkIPs.forEach(ip => {
      const url = `http://${ip.address}:${port}`;
      html += `
        <div class="ip-box">
          <span class="label">VM LAN Interface (${ip.interface})</span>
          <code>${url}</code>
        </div>
      `;
    });

    list.innerHTML = html;

    if (qrText) qrText.textContent = primaryUrl;

    if (qrContainer && window.QRCode) {
      qrContainer.innerHTML = '';
      new window.QRCode(qrContainer, {
        text: primaryUrl,
        width: 140,
        height: 140,
        colorDark: '#0b0f19',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.H
      });
    }
  }

  /* ==========================================================================
     ORDER READY MODAL
     ========================================================================== */
  function initReadyModal() {
    const dismissBtn = document.getElementById('btn-modal-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        document.getElementById('ready-modal').style.display = 'none';
      });
    }
  }

  function showOrderReadyModal(ticket, counterId) {
    const modal = document.getElementById('ready-modal');
    if (!modal) return;

    document.getElementById('modal-ticket-num').textContent = ticket.ticketNumber;
    document.getElementById('modal-counter-name').textContent = ticket.counterName || counterId;
    modal.style.display = 'flex';
  }

  /* ==========================================================================
     MASTER RENDER ROUTINE
     ========================================================================== */
  function renderAllViews() {
    // Render counter badge numbers on radio selections
    if (state.serverQueues) {
      const counters = state.serverQueues.counters;
      if (counters['hot-meals']) document.getElementById('badge-hot-meals').textContent = `${counters['hot-meals'].activeCount} waiting`;
      if (counters['snacks-drinks']) document.getElementById('badge-snacks-drinks').textContent = `${counters['snacks-drinks'].activeCount} waiting`;
      if (counters['express-deli']) document.getElementById('badge-express-deli').textContent = `${counters['express-deli'].activeCount} waiting`;
    }

    renderStudentTracker();

    if (state.activeTab === 'staff') {
      renderStaffDashboard();
    } else if (state.activeTab === 'tv') {
      renderTVDisplay();
    }
  }
});
