/**
 * app.js — Main Application Controller for LastLap
 * Coordinates UI events, database, study engine, scheduling, and import pipelines.
 */

class App {
  constructor() {
    this.currentCalendarDate = new Date();
    this.exams = [];
    this.currentStudySession = null;
    this.pendingImportData = null; // Holds parsed file state
    this.activeExamForManager = null;
  }

  async init() {
    try {
      // 1. Initialize IndexedDB
      await db.init();
      this.initTheme();
      this.bindGlobalEvents();

      // 2. Load all exams and render views
      await this.reloadDashboard();

      console.log('LastLap initialized successfully.');
    } catch (err) {
      console.error('Initialization error:', err);
      this.showToast('Failed to initialize local database: ' + err.message, 'error');
    }
  }

  // ================= THEME & GLOBAL EVENTS =================
  initTheme() {
    const savedTheme = localStorage.getItem('lastlap_theme') || 'theme-light';
    document.body.className = savedTheme;
  }

  toggleTheme() {
    const isDark = document.body.classList.contains('theme-dark');
    const newTheme = isDark ? 'theme-light' : 'theme-dark';
    document.body.className = newTheme;
    localStorage.setItem('lastlap_theme', newTheme);
  }

  bindGlobalEvents() {
    // Theme toggle
    document.getElementById('btn-theme-toggle').addEventListener('click', () => this.toggleTheme());

    // New Exam Buttons
    document.getElementById('btn-new-exam-top').addEventListener('click', () => this.openExamModal());
    document.getElementById('btn-new-exam-body').addEventListener('click', () => this.openExamModal());
    const emptyBtn = document.getElementById('btn-empty-add-exam');
    if (emptyBtn) emptyBtn.addEventListener('click', () => this.openExamModal());

    // Calendar month navigation
    document.getElementById('btn-cal-prev').addEventListener('click', () => {
      this.currentCalendarDate.setMonth(this.currentCalendarDate.getMonth() - 1);
      this.renderCalendar();
    });
    document.getElementById('btn-cal-next').addEventListener('click', () => {
      this.currentCalendarDate.setMonth(this.currentCalendarDate.getMonth() + 1);
      this.renderCalendar();
    });

    // Modal Close buttons (all elements with data-close-modal)
    document.querySelectorAll('[data-close-modal]').forEach((el) => {
      el.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-backdrop');
        if (modal) this.closeModal(modal);
      });
    });

    // Close modal on click outside dialog
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop && !backdrop.classList.contains('no-backdrop-close')) {
          this.closeModal(backdrop);
        }
      });
    });

    // Exam Form submission
    document.getElementById('form-exam').addEventListener('submit', (e) => this.handleSaveExam(e));

    // Dynamic schedule estimation inputs inside exam modal
    const estimatorInputs = [
      'exam-date',
      'exam-num-cards',
      'exam-daily-time',
      'exam-mastery-level',
      'exam-sec-per-card',
      'exam-review-allowance'
    ];
    estimatorInputs.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => this.updateLiveSchedulePreview());
        el.addEventListener('change', () => this.updateLiveSchedulePreview());
      }
    });

    // Import pipeline events
    this.bindImportEvents();

    // Study session interactive events
    this.bindStudyEvents();

    // Card manager events
    this.bindCardManagerEvents();

    // Backup & Restore events
    this.bindBackupEvents();
  }

  // ================= DASHBOARD & VIEWS =================
  async reloadDashboard() {
    this.exams = await db.getAllExams();
    this.renderCalendar();
    await this.renderTodayTasks();
    await this.renderExamSections();
  }

  // --- 3.1 Exam Calendar Rendering ---
  renderCalendar() {
    const year = this.currentCalendarDate.getFullYear();
    const month = this.currentCalendarDate.getMonth();

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    document.getElementById('cal-month-label').textContent = `${monthNames[month]} ${year}`;

    const container = document.getElementById('calendar-days');
    container.innerHTML = '';

    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
    const todayStr = new Date().toISOString().split('T')[0];

    // Map exam dates and recommended start dates
    const examDateMap = new Map();
    const startDateMap = new Map();

    this.exams.forEach((exam) => {
      if (exam.examDate) {
        const list = examDateMap.get(exam.examDate) || [];
        list.push(exam);
        examDateMap.set(exam.examDate, list);
      }
      if (exam.scheduleSettings && exam.scheduleSettings.recommendedStartDate) {
        const list = startDateMap.get(exam.scheduleSettings.recommendedStartDate) || [];
        list.push(exam);
        startDateMap.set(exam.scheduleSettings.recommendedStartDate, list);
      }
    });

    // Leading empty days
    for (let i = 0; i < firstDayIndex; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'cal-day-cell empty-day';
      container.appendChild(emptyCell);
    }

    // Days of month
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const cell = document.createElement('div');
      cell.className = 'cal-day-cell';

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      if (dateStr === todayStr) {
        cell.classList.add('is-today');
      }

      const examsOnDate = examDateMap.get(dateStr);
      const startsOnDate = startDateMap.get(dateStr);

      if (examsOnDate && examsOnDate.length > 0) {
        cell.classList.add('is-exam-day');
      }
      if (startsOnDate && startsOnDate.length > 0) {
        cell.classList.add('is-start-day');
      }

      const headerEl = document.createElement('div');
      headerEl.className = 'cal-day-header';

      const numEl = document.createElement('span');
      numEl.className = 'cal-day-number';
      numEl.textContent = d;
      headerEl.appendChild(numEl);

      cell.appendChild(headerEl);

      // Event badges with test names
      if ((examsOnDate && examsOnDate.length > 0) || (startsOnDate && startsOnDate.length > 0)) {
        const eventsContainer = document.createElement('div');
        eventsContainer.className = 'cal-events-container';

        if (examsOnDate) {
          examsOnDate.forEach((exam) => {
            const badge = document.createElement('div');
            badge.className = 'cal-event-badge exam-badge';
            badge.textContent = `📝 ${exam.name}`;
            badge.title = `Exam: ${exam.name}`;
            eventsContainer.appendChild(badge);
          });
        }
        if (startsOnDate) {
          startsOnDate.forEach((exam) => {
            const badge = document.createElement('div');
            badge.className = 'cal-event-badge start-badge';
            badge.textContent = `🚀 Start: ${exam.name}`;
            badge.title = `Study Start: ${exam.name}`;
            eventsContainer.appendChild(badge);
          });
        }
        cell.appendChild(eventsContainer);
      }

      // Click day to filter or preview info
      cell.addEventListener('click', () => {
        const details = [];
        if (examsOnDate && examsOnDate.length > 0) {
          details.push(`Exams: ${examsOnDate.map((e) => e.name).join(', ')}`);
        }
        if (startsOnDate && startsOnDate.length > 0) {
          details.push(`Study Start: ${startsOnDate.map((e) => e.name).join(', ')}`);
        }
        if (details.length > 0) {
          this.showToast(`${dateStr} — ${details.join(' | ')}`);
        }
      });

      container.appendChild(cell);
    }
  }

  // --- 3.2 Today's Tasks Rendering ---
  async renderTodayTasks() {
    const container = document.getElementById('today-tasks-container');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayStr = today.toISOString().split('T')[0];
    document.getElementById('today-date-badge').textContent = today.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });

    if (this.exams.length === 0) {
      container.innerHTML = `
        <div class="empty-state glass-panel">
          <p>No exams registered yet. Create your first exam to generate your personalized study plan.</p>
          <button id="btn-empty-add-exam" class="btn btn-primary btn-sm">Create Exam</button>
        </div>
      `;
      const btn = document.getElementById('btn-empty-add-exam');
      if (btn) btn.addEventListener('click', () => this.openExamModal());
      return;
    }

    container.innerHTML = '';
    let tasksCount = 0;

    for (const exam of this.exams) {
      const cards = await db.getCardsByExam(exam.id);
      const progress = await db.getProgressByExam(exam.id);

      const examDate = new Date(exam.examDate);
      examDate.setHours(0, 0, 0, 0);
      const daysLeft = Math.ceil((examDate - today) / (1000 * 60 * 60 * 24));

      const recStartDate = exam.scheduleSettings && exam.scheduleSettings.recommendedStartDate
        ? new Date(exam.scheduleSettings.recommendedStartDate)
        : null;

      const phase = exam.currentPhase || StudyPhase.PHASE_1;

      // Identify weak cards
      const weakCards = progress.filter(
        (p) => p.lastResult === ReviewResult.INCORRECT || p.lastResult === ReviewResult.UNCERTAIN || (p.consecutiveCorrect || 0) < 3
      );

      // Determine task recommendation
      let taskTitle = '';
      let taskMeta = '';
      let actionLabel = 'Study Now';
      let actionType = 'phase';
      let isUrgent = daysLeft <= 3 && daysLeft >= 0;

      if (cards.length === 0) {
        taskTitle = `Import materials for "${exam.name}"`;
        taskMeta = `Exam is in ${daysLeft} day(s). Materials needed to begin Phase 1.`;
        actionLabel = 'Import Material';
        actionType = 'import';
      } else if (phase === StudyPhase.PHASE_1) {
        const reviewedCount = progress.filter((p) => p.reviewCount > 0).length;
        if (reviewedCount < cards.length) {
          taskTitle = `Complete Phase 1 Diagnostic for "${exam.name}"`;
          taskMeta = `${reviewedCount} of ${cards.length} cards diagnosed. Assess weak areas.`;
          actionLabel = 'Continue Phase 1';
          actionType = 'phase';
        } else {
          taskTitle = `Advance "${exam.name}" to Phase 2`;
          taskMeta = `Phase 1 diagnostic completed (${weakCards.length} weak cards flagged).`;
          actionLabel = 'Advance Phase';
          actionType = 'advance';
        }
      } else if (phase === StudyPhase.PHASE_2) {
        if (weakCards.length > 0) {
          taskTitle = `Phase 2: Reinforce weak cards for "${exam.name}"`;
          taskMeta = `${weakCards.length} weak cards pending 3 consecutive recalls.`;
          actionLabel = 'Reinforce Weak';
          actionType = 'phase';
        } else {
          taskTitle = `Advance "${exam.name}" to Phase 3 (Final Review)`;
          taskMeta = `All cards provisionally mastered in Phase 2.`;
          actionLabel = 'Advance to Final';
          actionType = 'advance';
        }
      } else {
        // Phase 3
        taskTitle = `Phase 3: Final 6-stage review for "${exam.name}"`;
        taskMeta = `Exam in ${daysLeft} day(s). Verify final readiness across all categories.`;
        actionLabel = 'Run Final Review';
        actionType = 'phase';
      }

      tasksCount++;
      const taskCard = document.createElement('div');
      taskCard.className = `task-card glass-panel ${isUrgent ? 'task-urgent' : ''}`;
      taskCard.innerHTML = `
        <div class="task-details">
          <span class="task-title">${CardManager.escape(taskTitle)}</span>
          <span class="task-meta">${CardManager.escape(taskMeta)}</span>
        </div>
        <div class="task-actions">
          <button class="btn btn-primary btn-sm btn-task-action" data-exam-id="${exam.id}" data-action="${actionType}">
            ${actionLabel}
          </button>
        </div>
      `;

      taskCard.querySelector('.btn-task-action').addEventListener('click', async (e) => {
        const action = e.currentTarget.dataset.action;
        if (action === 'import') {
          this.openImportModal(exam);
        } else if (action === 'advance') {
          await this.handleAdvancePhase(exam);
        } else {
          await this.startStudySession(exam, SessionMode.PHASE);
        }
      });

      container.appendChild(taskCard);
    }
  }

  // --- 3.3 Exam Sections Rendering ---
  async renderExamSections() {
    const container = document.getElementById('exams-container');
    container.innerHTML = '';

    if (this.exams.length === 0) {
      container.innerHTML = `
        <div class="empty-state glass-panel">
          <p>No exams registered yet. Click "Add Exam" to get started.</p>
        </div>
      `;
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const exam of this.exams) {
      const cards = await db.getCardsByExam(exam.id);
      const progress = await db.getProgressByExam(exam.id);

      const examDate = new Date(exam.examDate);
      examDate.setHours(0, 0, 0, 0);
      const daysLeft = Math.ceil((examDate - today) / (1000 * 60 * 60 * 24));

      // Calculate progress distribution
      const totalCards = cards.length;
      let masteredCount = 0;
      let weakCount = 0;
      let unstudiedCount = 0;

      cards.forEach((card) => {
        const p = progress.find((prog) => prog.cardId === card.id);
        if (!p || (p.reviewCount || 0) === 0) {
          unstudiedCount++;
        } else if ((p.consecutiveCorrect || 0) >= 3 || p.provisionalMastery) {
          masteredCount++;
        } else {
          weakCount++;
        }
      });

      const masteredPercent = totalCards > 0 ? (masteredCount / totalCards) * 100 : 0;
      const weakPercent = totalCards > 0 ? (weakCount / totalCards) * 100 : 0;

      // Phase title display
      const phaseNames = {
        1: 'Phase 1: Whole-Deck Diagnostic',
        2: 'Phase 2: Weak-Card Reinforcement',
        3: 'Phase 3: Final 6-Stage Review'
      };
      const phaseName = phaseNames[exam.currentPhase || 1];

      let countdownBadgeClass = 'normal';
      let countdownText = `${daysLeft} days left`;
      if (daysLeft < 0) {
        countdownBadgeClass = 'urgent';
        countdownText = `Past (${Math.abs(daysLeft)}d ago)`;
      } else if (daysLeft === 0) {
        countdownBadgeClass = 'urgent';
        countdownText = 'EXAM TODAY!';
      } else if (daysLeft <= 3) {
        countdownBadgeClass = 'urgent';
        countdownText = `${daysLeft} days left (Urgent!)`;
      }

      const pausedSession = this.getPausedSession(exam.id);
      const hasPaused = pausedSession && Array.isArray(pausedSession.queue) && pausedSession.currentIndex < pausedSession.queue.length;

      const cardEl = document.createElement('div');
      cardEl.className = 'exam-card glass-panel';
      cardEl.innerHTML = `
        <div class="exam-card-header">
          <div class="exam-title-box">
            <h3 class="exam-card-name">${CardManager.escape(exam.name)}</h3>
            <span class="exam-countdown-badge ${countdownBadgeClass}">
              📅 ${exam.examDate} • ${countdownText}
            </span>
          </div>
          <button class="exam-card-menu-btn" data-exam-edit="${exam.id}" title="Edit Exam Settings">⚙️</button>
        </div>

        <div class="exam-progress-overview">
          <div class="progress-info-row">
            <span>Study Progress</span>
            <span>${masteredCount} / ${totalCards} Mastered (${Math.round(masteredPercent)}%)</span>
          </div>
          <div class="progress-track" title="${masteredCount} Mastered, ${weakCount} Weak, ${unstudiedCount} Unstudied">
            <div class="progress-segment-mastered" style="width: ${masteredPercent}%;"></div>
            <div class="progress-segment-weak" style="width: ${weakPercent}%;"></div>
            <div class="progress-segment-unstudied" style="width: ${100 - masteredPercent - weakPercent}%;"></div>
          </div>
          <div class="exam-stat-pills">
            <span class="stat-pill">Total: ${totalCards}</span>
            <span class="stat-pill" style="color: var(--success);">Mastered: ${masteredCount}</span>
            <span class="stat-pill" style="color: var(--warning);">Needs Work: ${weakCount}</span>
            <span class="stat-pill">Unstudied: ${unstudiedCount}</span>
          </div>
        </div>

        <div class="exam-phase-banner">
          <span class="phase-text">${phaseName}</span>
          <button class="btn btn-secondary btn-sm btn-advance-phase" data-exam-id="${exam.id}">
            Advance Phase ➔
          </button>
        </div>

        ${hasPaused ? `
          <div class="exam-paused-banner">
            <div class="paused-banner-left">
              <span class="paused-icon">⏸️</span>
              <div>
                <div class="paused-title">Paused Session in Progress</div>
                <div class="paused-subtitle">Card ${pausedSession.currentIndex + 1} of ${pausedSession.queue.length} (${Math.round((pausedSession.currentIndex / pausedSession.queue.length) * 100)}%) • ${pausedSession.mode === SessionMode.REVIEW_WEAK ? 'Weak Cards' : (pausedSession.mode === SessionMode.REVIEW_ALL ? 'Review All' : `Phase ${pausedSession.phase}`)}</div>
              </div>
            </div>
            <button class="link-btn link-btn-danger btn-discard-session" data-exam-id="${exam.id}" title="Discard paused session">Discard</button>
          </div>
        ` : ''}

        <div class="exam-actions-row">
          ${totalCards === 0 ? `
            <button class="btn btn-primary btn-import-materials action-btn-wide" data-exam-id="${exam.id}">
              📥 Import Study Materials
            </button>
          ` : hasPaused ? `
            <button class="btn btn-primary btn-resume-study" data-exam-id="${exam.id}">
              ▶️ Resume Study (Card ${pausedSession.currentIndex + 1}/${pausedSession.queue.length})
            </button>
            <button class="btn btn-outline btn-study-phase" data-exam-id="${exam.id}">
              ↺ Restart Session
            </button>
            <button class="btn btn-secondary btn-review-weak" data-exam-id="${exam.id}">
              🎯 Review Weak (${weakCount})
            </button>
          ` : `
            <button class="btn btn-primary btn-study-phase" data-exam-id="${exam.id}">
              ⚡ Study (${phaseName.split(':')[0]})
            </button>
            <button class="btn btn-secondary btn-review-weak" data-exam-id="${exam.id}">
              🎯 Review Weak Cards (${weakCount})
            </button>
            <button class="btn btn-outline btn-review-all" data-exam-id="${exam.id}">
              🔄 Review All (${totalCards})
            </button>
          `}
        </div>

        <div class="exam-secondary-actions">
          <button class="link-btn btn-manage-deck" data-exam-id="${exam.id}">View / Edit Cards</button>
          <span>•</span>
          <button class="link-btn btn-reimport" data-exam-id="${exam.id}">Import More Cards</button>
          <span>•</span>
          <button class="link-btn link-btn-danger btn-delete-exam" data-exam-id="${exam.id}">Delete Exam</button>
        </div>
      `;

      // Event Listeners for Exam Card buttons
      cardEl.querySelector('[data-exam-edit]').addEventListener('click', () => this.openExamModal(exam));
      
      const importBtn = cardEl.querySelector('.btn-import-materials');
      if (importBtn) importBtn.addEventListener('click', () => this.openImportModal(exam));

      const reimportBtn = cardEl.querySelector('.btn-reimport');
      if (reimportBtn) reimportBtn.addEventListener('click', () => this.openImportModal(exam));

      const resumeBtn = cardEl.querySelector('.btn-resume-study');
      if (resumeBtn) resumeBtn.addEventListener('click', () => this.resumeStudySession(exam));

      const discardBtn = cardEl.querySelector('.btn-discard-session');
      if (discardBtn) {
        discardBtn.addEventListener('click', () => {
          if (confirm('Discard paused session progress and start fresh next time?')) {
            this.clearPausedSession(exam.id);
            this.reloadDashboard();
            this.showToast('Paused session discarded.', 'info');
          }
        });
      }

      const studyPhaseBtn = cardEl.querySelector('.btn-study-phase');
      if (studyPhaseBtn) {
        studyPhaseBtn.addEventListener('click', () => {
          if (hasPaused) {
            this.clearPausedSession(exam.id);
          }
          this.startStudySession(exam, SessionMode.PHASE);
        });
      }

      const reviewWeakBtn = cardEl.querySelector('.btn-review-weak');
      if (reviewWeakBtn) {
        reviewWeakBtn.addEventListener('click', () => {
          if (hasPaused && pausedSession.mode === SessionMode.REVIEW_WEAK) {
            this.resumeStudySession(exam);
          } else {
            this.startStudySession(exam, SessionMode.REVIEW_WEAK);
          }
        });
      }

      const reviewAllBtn = cardEl.querySelector('.btn-review-all');
      if (reviewAllBtn) reviewAllBtn.addEventListener('click', () => this.startStudySession(exam, SessionMode.REVIEW_ALL));

      cardEl.querySelector('.btn-advance-phase').addEventListener('click', () => this.handleAdvancePhase(exam));
      cardEl.querySelector('.btn-manage-deck').addEventListener('click', () => this.openCardManager(exam));
      cardEl.querySelector('.btn-delete-exam').addEventListener('click', () => this.handleDeleteExam(exam));

      container.appendChild(cardEl);
    }
  }

  // ================= 5. EXAM CREATION & SCHEDULING MODAL =================
  openExamModal(exam = null) {
    const modal = document.getElementById('modal-exam');
    const titleEl = document.getElementById('modal-exam-title');
    const form = document.getElementById('form-exam');
    form.reset();

    if (exam) {
      titleEl.textContent = 'Edit Exam & Schedule';
      document.getElementById('exam-id').value = exam.id;
      document.getElementById('exam-name').value = exam.name || '';
      document.getElementById('exam-date').value = exam.examDate || '';

      const s = exam.scheduleSettings || {};
      document.getElementById('exam-num-cards').value = s.numCards || 60;
      document.getElementById('exam-daily-time').value = s.dailyMinutes || 30;
      document.getElementById('exam-mastery-level').value = s.masteryLevel || 'NOT_STUDIED';
      document.getElementById('exam-sec-per-card').value = s.secondsPerCard || 20;
      document.getElementById('exam-review-allowance').value = s.reviewAllowance || '0.5';
    } else {
      titleEl.textContent = 'Register New Exam';
      document.getElementById('exam-id').value = '';
      // Default to 14 days from today
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + 14);
      document.getElementById('exam-date').value = defaultDate.toISOString().split('T')[0];
      document.getElementById('exam-num-cards').value = 60;
      document.getElementById('exam-daily-time').value = 30;
      document.getElementById('exam-mastery-level').value = 'NOT_STUDIED';
      document.getElementById('exam-sec-per-card').value = 20;
      document.getElementById('exam-review-allowance').value = '0.5';
    }

    this.updateLiveSchedulePreview();
    this.openModal(modal);
  }

  updateLiveSchedulePreview() {
    const examDate = document.getElementById('exam-date').value;
    const numCards = document.getElementById('exam-num-cards').value;
    const dailyMinutes = document.getElementById('exam-daily-time').value;
    const masteryLevel = document.getElementById('exam-mastery-level').value;
    const secondsPerCard = document.getElementById('exam-sec-per-card').value;
    const reviewAllowance = document.getElementById('exam-review-allowance').value;

    if (!examDate) {
      document.getElementById('preview-start-date').textContent = 'Please choose exam date';
      return;
    }

    const calc = ScheduleCalculator.calculate({
      examDate,
      numCards,
      secondsPerCard,
      reviewAllowance,
      dailyMinutes,
      masteryLevel
    });

    document.getElementById('preview-total-time').textContent = `${calc.totalMinutes} mins (~${calc.totalHours} hrs)`;
    document.getElementById('preview-total-days').textContent = `${calc.requiredDays} study days needed`;
    document.getElementById('preview-start-date').textContent = `${calc.recommendedStartDate} (${calc.daysRemaining}d until exam)`;
    document.getElementById('preview-assumptions').textContent = calc.assumptionsText;

    const warnBox = document.getElementById('preview-warning');
    if (calc.warnings.length > 0) {
      warnBox.textContent = calc.warnings.join(' ');
      warnBox.classList.remove('hidden');
    } else {
      warnBox.classList.add('hidden');
    }
  }

  async handleSaveExam(e) {
    e.preventDefault();
    const id = document.getElementById('exam-id').value || generateId();
    const name = document.getElementById('exam-name').value.trim();
    const examDate = document.getElementById('exam-date').value;

    if (!name || !examDate) {
      this.showToast('Please provide both exam name and date.', 'error');
      return;
    }

    const numCards = parseInt(document.getElementById('exam-num-cards').value, 10) || 60;
    const dailyMinutes = parseInt(document.getElementById('exam-daily-time').value, 10) || 30;
    const masteryLevel = document.getElementById('exam-mastery-level').value;
    const secondsPerCard = parseFloat(document.getElementById('exam-sec-per-card').value) || 20;
    const reviewAllowance = parseFloat(document.getElementById('exam-review-allowance').value) || 0.5;

    const scheduleCalculation = ScheduleCalculator.calculate({
      examDate,
      numCards,
      secondsPerCard,
      reviewAllowance,
      dailyMinutes,
      masteryLevel
    });

    // Existing exam check
    let existingExam = await db.getExam(id);
    const examObj = {
      id,
      name,
      examDate,
      currentPhase: existingExam ? (existingExam.currentPhase || StudyPhase.PHASE_1) : StudyPhase.PHASE_1,
      scheduleSettings: {
        numCards,
        dailyMinutes,
        masteryLevel,
        secondsPerCard,
        reviewAllowance,
        recommendedStartDate: scheduleCalculation.recommendedStartDate,
        totalMinutes: scheduleCalculation.totalMinutes,
        requiredDays: scheduleCalculation.requiredDays,
        updatedAt: new Date().toISOString()
      },
      createdAt: existingExam ? existingExam.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    try {
      await db.saveExam(examObj);
      this.closeModal(document.getElementById('modal-exam'));
      this.showToast(`Exam "${name}" saved successfully!`, 'success');
      await this.reloadDashboard();
    } catch (err) {
      this.showToast('Error saving exam: ' + err.message, 'error');
    }
  }

  async handleDeleteExam(exam) {
    const confirmed = confirm(`Are you sure you want to delete exam "${exam.name}"? This will permanently delete all associated flashcards and study history.`);
    if (!confirmed) return;

    try {
      await db.deleteExam(exam.id);
      this.showToast(`Exam "${exam.name}" deleted.`, 'success');
      await this.reloadDashboard();
    } catch (err) {
      this.showToast('Delete failed: ' + err.message, 'error');
    }
  }

  async handleAdvancePhase(exam) {
    const current = exam.currentPhase || StudyPhase.PHASE_1;
    if (current >= StudyPhase.PHASE_3) {
      const reset = confirm(`"${exam.name}" is already at Phase 3 (Final Review). Would you like to restart from Phase 1 or Phase 2?`);
      if (reset) {
        exam.currentPhase = StudyPhase.PHASE_1;
        await db.saveExam(exam);
        this.showToast(`Exam reset to Phase 1. Study history was preserved.`, 'success');
        await this.reloadDashboard();
      }
      return;
    }

    const nextPhase = current + 1;
    const phaseNames = {
      1: 'Phase 1: Whole-Deck Diagnostic',
      2: 'Phase 2: Weak-Card Reinforcement',
      3: 'Phase 3: Final 6-Stage Review'
    };

    const confirmAdvance = confirm(
      `Advance "${exam.name}" to ${phaseNames[nextPhase]}?\nAll cards and study history will be preserved.`
    );
    if (!confirmAdvance) return;

    exam.currentPhase = nextPhase;
    await db.saveExam(exam);
    this.showToast(`Advanced to ${phaseNames[nextPhase]}!`, 'success');
    await this.reloadDashboard();
  }

  // ================= 4. STUDY MATERIAL IMPORT PIPELINE =================
  bindImportEvents() {
    const fileInput = document.getElementById('file-input');
    const dropZone = document.getElementById('file-drop-zone');
    const btnChoose = document.getElementById('btn-choose-file');

    btnChoose.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('click', (e) => {
      if (e.target !== btnChoose) fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.processImportFile(file);
    });

    // Drag and drop
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.processImportFile(e.dataTransfer.files[0]);
      }
    });

    // Back to file selection
    document.getElementById('btn-import-back').addEventListener('click', () => {
      document.getElementById('import-step-file').classList.remove('hidden');
      document.getElementById('import-step-mapping').classList.add('hidden');
      document.getElementById('btn-import-back').classList.add('hidden');
      document.getElementById('btn-import-confirm').classList.add('hidden');
    });

    // Mapping dropdown change events
    document.getElementById('select-front-col').addEventListener('change', () => this.updateImportPreview());
    document.getElementById('select-back-col').addEventListener('change', () => this.updateImportPreview());
    document.getElementById('chk-force-cloze').addEventListener('change', () => this.updateImportPreview());

    // Confirm Import
    document.getElementById('btn-import-confirm').addEventListener('click', () => this.executeCardImport());
  }

  openImportModal(exam) {
    this.activeImportExam = exam;
    document.getElementById('import-exam-subtitle').textContent = `For: ${exam.name}`;
    document.getElementById('import-step-file').classList.remove('hidden');
    document.getElementById('import-step-mapping').classList.add('hidden');
    document.getElementById('btn-import-back').classList.add('hidden');
    document.getElementById('btn-import-confirm').classList.add('hidden');
    document.getElementById('file-input').value = '';
    this.pendingImportData = null;

    this.openModal(document.getElementById('modal-import'));
  }

  async processImportFile(file) {
    try {
      const text = await file.text();
      const parsed = FileImporter.parseDelimitedText(text);

      if (parsed.error || parsed.rows.length === 0) {
        this.showToast('Import error: ' + (parsed.error || 'No valid rows found.'), 'error');
        return;
      }

      this.pendingImportData = {
        fileName: file.name,
        headers: parsed.headers,
        rows: parsed.rows,
        totalRows: parsed.totalRows,
        delimiter: parsed.delimiter
      };

      // Switch to Step 2 (Mapping & Preview)
      document.getElementById('import-step-file').classList.add('hidden');
      document.getElementById('import-step-mapping').classList.remove('hidden');
      document.getElementById('btn-import-back').classList.remove('hidden');
      document.getElementById('btn-import-confirm').classList.remove('hidden');

      document.getElementById('import-file-info').textContent = `${file.name} (${parsed.totalRows} rows)`;

      this.populateMappingSelectors(parsed.headers);
      this.updateImportPreview();
    } catch (err) {
      console.error('File reading failed:', err);
      this.showToast('Failed to read file: ' + err.message, 'error');
    }
  }

  populateMappingSelectors(headers) {
    const frontSelect = document.getElementById('select-front-col');
    const backSelect = document.getElementById('select-back-col');
    const suppContainer = document.getElementById('supplementary-fields-list');

    frontSelect.innerHTML = '';
    backSelect.innerHTML = '';
    suppContainer.innerHTML = '';

    headers.forEach((header, idx) => {
      const optFront = document.createElement('option');
      optFront.value = idx;
      optFront.textContent = header;
      frontSelect.appendChild(optFront);

      const optBack = document.createElement('option');
      optBack.value = idx;
      optBack.textContent = header;
      backSelect.appendChild(optBack);

      // Supplementary checkbox tag
      const tagLabel = document.createElement('label');
      tagLabel.className = 'checkbox-tag-item';
      tagLabel.innerHTML = `
        <input type="checkbox" class="chk-supp-col" value="${idx}">
        <span>${CardManager.escape(header)}</span>
      `;
      tagLabel.querySelector('input').addEventListener('change', () => this.updateImportPreview());
      suppContainer.appendChild(tagLabel);
    });

    // Heuristic pre-selection: default front=0, back=1
    if (headers.length > 1) {
      frontSelect.value = 0;
      backSelect.value = 1;
    }

    // Check if front contains cloze syntax
    const sampleText = this.pendingImportData.rows.slice(0, 5).map((r) => r[0] || '').join(' ');
    const hasCloze = ClozeParser.extractIndices(sampleText).length > 0;
    document.getElementById('chk-force-cloze').checked = hasCloze;
  }

  updateImportPreview() {
    if (!this.pendingImportData) return;

    const { headers, rows } = this.pendingImportData;
    const frontIdx = parseInt(document.getElementById('select-front-col').value, 10);
    const backIdx = parseInt(document.getElementById('select-back-col').value, 10);
    const isCloze = document.getElementById('chk-force-cloze').checked;

    // Toggle Back column visibility if in cloze mode
    const groupBack = document.getElementById('group-back-col');
    if (isCloze) {
      groupBack.style.opacity = '0.5';
    } else {
      groupBack.style.opacity = '1';
    }

    // Supplementary checkboxes
    const suppIndices = Array.from(document.querySelectorAll('.chk-supp-col:checked'))
      .map((cb) => parseInt(cb.value, 10))
      .filter((idx) => idx !== frontIdx && idx !== backIdx);

    // 1. Render First 5 rows in Table
    const thead = document.getElementById('preview-table-head');
    const tbody = document.getElementById('preview-table-body');
    thead.innerHTML = `<tr>${headers.map((h, i) => {
      let role = '';
      if (i === frontIdx) role = ' [Front]';
      else if (!isCloze && i === backIdx) role = ' [Back]';
      else if (suppIndices.includes(i)) role = ' [Supp]';
      return `<th>${CardManager.escape(h + role)}</th>`;
    }).join('')}</tr>`;

    tbody.innerHTML = rows.slice(0, 5).map((row) => `
      <tr>${row.map((cell) => `<td>${CardManager.escape(cell.slice(0, 50))}</td>`).join('')}</tr>
    `).join('');

    // 2. Build sample cards to test mapping
    const sampleResult = FileImporter.buildCardsFromParsedData({
      examId: this.activeImportExam.id,
      headers,
      rows,
      mapping: {
        frontColIndex: frontIdx,
        backColIndex: isCloze ? -1 : backIdx,
        supplementaryIndices: suppIndices,
        isClozeMode: isCloze
      }
    });

    document.getElementById('import-count-badge').textContent = sampleResult.cards.length;

    // 3. Render Sample Resulting Card
    if (sampleResult.cards.length > 0) {
      const sampleCard = sampleResult.cards[0];
      const frontBox = document.getElementById('sample-front-text');
      const backBox = document.getElementById('sample-back-text');
      const suppBox = document.getElementById('sample-supp-box');
      const suppText = document.getElementById('sample-supp-text');

      if (sampleCard.cardType === CardType.CLOZE) {
        frontBox.innerHTML = ClozeParser.renderQuestion(sampleCard.clozeData.rawText, sampleCard.clozeData.targetIndex);
        backBox.innerHTML = ClozeParser.renderAnswer(sampleCard.clozeData.rawText, sampleCard.clozeData.targetIndex);
      } else {
        frontBox.textContent = sampleCard.front;
        backBox.textContent = sampleCard.back;
      }

      if (sampleCard.supplementaryFields && sampleCard.supplementaryFields.length > 0) {
        suppBox.classList.remove('hidden');
        suppText.innerHTML = sampleCard.supplementaryFields
          .map((f) => `<div><strong>${CardManager.escape(f.label)}:</strong> ${CardManager.escape(f.value)}</div>`)
          .join('');
      } else {
        suppBox.classList.add('hidden');
      }
    }

    // 4. Alerts & Warnings
    const alertsBox = document.getElementById('import-alerts-box');
    const messages = [...sampleResult.errors, ...sampleResult.warnings];
    if (messages.length > 0) {
      alertsBox.innerHTML = `<strong>Note:</strong><br>${messages.slice(0, 3).map((m) => `• ${CardManager.escape(m)}`).join('<br>')}`;
      alertsBox.classList.remove('hidden');
    } else {
      alertsBox.classList.add('hidden');
    }
  }

  async executeCardImport() {
    if (!this.pendingImportData || !this.activeImportExam) return;

    const { headers, rows } = this.pendingImportData;
    const frontIdx = parseInt(document.getElementById('select-front-col').value, 10);
    const backIdx = parseInt(document.getElementById('select-back-col').value, 10);
    const isCloze = document.getElementById('chk-force-cloze').checked;
    const suppIndices = Array.from(document.querySelectorAll('.chk-supp-col:checked')).map((cb) => parseInt(cb.value, 10));

    // Get existing cards to check duplicate
    const existingCards = await db.getCardsByExam(this.activeImportExam.id);

    const result = FileImporter.buildCardsFromParsedData({
      examId: this.activeImportExam.id,
      headers,
      rows,
      mapping: {
        frontColIndex: frontIdx,
        backColIndex: isCloze ? -1 : backIdx,
        supplementaryIndices: suppIndices,
        isClozeMode: isCloze
      },
      existingCards
    });

    if (result.cards.length === 0) {
      this.showToast('No valid cards could be generated from mapping.', 'error');
      return;
    }

    try {
      // Save cards bulk to IndexedDB
      await db.saveCardsBulk(result.cards);

      // Update exam's card count in scheduleSettings
      const totalCards = existingCards.length + result.cards.length;
      if (this.activeImportExam.scheduleSettings) {
        this.activeImportExam.scheduleSettings.numCards = totalCards;
        // Recalculate schedule
        const newSched = ScheduleCalculator.calculate({
          examDate: this.activeImportExam.examDate,
          numCards: totalCards,
          secondsPerCard: this.activeImportExam.scheduleSettings.secondsPerCard,
          reviewAllowance: this.activeImportExam.scheduleSettings.reviewAllowance,
          dailyMinutes: this.activeImportExam.scheduleSettings.dailyMinutes,
          masteryLevel: this.activeImportExam.scheduleSettings.masteryLevel
        });
        this.activeImportExam.scheduleSettings.recommendedStartDate = newSched.recommendedStartDate;
        this.activeImportExam.scheduleSettings.totalMinutes = newSched.totalMinutes;
        this.activeImportExam.scheduleSettings.requiredDays = newSched.requiredDays;
        await db.saveExam(this.activeImportExam);
      }

      this.closeModal(document.getElementById('modal-import'));
      this.showToast(`Successfully imported ${result.cards.length} cards!`, 'success');
      await this.reloadDashboard();
    } catch (err) {
      console.error('Import save failed:', err);
      this.showToast('Import database save failed: ' + err.message, 'error');
    }
  }

  // ================= 6 & 7. STUDY SESSIONS & REVIEW ACTIONS =================
  getPausedSession(examId) {
    try {
      const raw = localStorage.getItem(`lastlap_paused_session_${examId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.queue) && typeof parsed.currentIndex === 'number') {
        return parsed;
      }
      return null;
    } catch (e) {
      console.error('Failed to get paused session:', e);
      return null;
    }
  }

  savePausedSession(session) {
    if (!session || !session.exam) return;
    try {
      const state = session.exportState();
      localStorage.setItem(`lastlap_paused_session_${session.exam.id}`, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save paused session to localStorage:', e);
    }
  }

  clearPausedSession(examId) {
    try {
      localStorage.removeItem(`lastlap_paused_session_${examId}`);
    } catch (e) {
      console.error('Failed to clear paused session:', e);
    }
  }

  bindStudyEvents() {
    // Reveal Answer
    document.getElementById('btn-reveal-answer').addEventListener('click', () => this.revealCurrentCardAnswer());

    // Rating Buttons
    document.querySelectorAll('[data-result]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const result = e.currentTarget.dataset.result;
        this.submitStudyRating(result);
      });
    });

    // Undo Button
    const undoBtn = document.getElementById('btn-study-undo');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => this.undoStudyRating());
    }

    // Exit Study View with Pause and Save
    document.getElementById('btn-study-exit').addEventListener('click', async () => {
      const exitConfirm = confirm('Pause and exit this session? Your progress will be saved so you can resume where you left off.');
      if (exitConfirm) {
        if (this.currentStudySession) {
          this.savePausedSession(this.currentStudySession);
          try {
            await db.saveCardProgressBulk(this.currentStudySession.getUpdatedProgressList());
          } catch (err) {
            console.error('Failed to persist progress on pause:', err);
          }
        }
        document.getElementById('study-view').classList.add('hidden');
        this.currentStudySession = null;
        this.showToast('Session paused. You can resume anytime from the dashboard!', 'info');
        this.reloadDashboard();
      }
    });

    // Keyboard Shortcuts for Study View
    window.addEventListener('keydown', (e) => {
      const studyView = document.getElementById('study-view');
      if (studyView.classList.contains('hidden')) return;

      // Undo shortcut: Z or U (or Ctrl+Z / Meta+Z)
      if ((e.key === 'z' || e.key === 'Z' || e.key === 'u' || e.key === 'U') && !e.shiftKey) {
        e.preventDefault();
        this.undoStudyRating();
        return;
      }

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (!this.currentStudySession.isAnswerRevealed) {
          this.revealCurrentCardAnswer();
        }
      } else if (e.key === '1') {
        e.preventDefault();
        if (this.currentStudySession.isAnswerRevealed) {
          this.submitStudyRating(ReviewResult.INCORRECT);
        }
      } else if (e.key === '2') {
        e.preventDefault();
        if (this.currentStudySession.isAnswerRevealed) {
          this.submitStudyRating(ReviewResult.UNCERTAIN);
        }
      } else if (e.key === '3') {
        e.preventDefault();
        if (this.currentStudySession.isAnswerRevealed) {
          this.submitStudyRating(ReviewResult.CONFIDENT);
        }
      } else if (e.key === 'Escape') {
        document.getElementById('btn-study-exit').click();
      }
    });

    // Return to dashboard after 3-second completion hold
    document.getElementById('btn-completion-done').addEventListener('click', () => {
      this.closeModal(document.getElementById('modal-completion'));
      this.reloadDashboard();
    });
  }

  async resumeStudySession(exam) {
    const paused = this.getPausedSession(exam.id);
    if (!paused) {
      this.showToast('No paused session found.', 'warning');
      return;
    }
    await this.startStudySession(exam, paused.mode, paused);
  }

  async startStudySession(exam, mode = SessionMode.PHASE, resumeState = null) {
    const cards = await db.getCardsByExam(exam.id);
    if (cards.length === 0) {
      this.showToast('Please import study materials before starting.', 'warning');
      this.openImportModal(exam);
      return;
    }

    const progressList = await db.getProgressByExam(exam.id);

    // Initialize Study Engine with resumeState if resuming
    this.currentStudySession = new StudySessionEngine(exam, cards, progressList, mode, resumeState);

    if (this.currentStudySession.queue.length === 0) {
      if (mode === SessionMode.REVIEW_WEAK) {
        this.showToast('No weak cards found! Great job. Launching Review All instead.', 'success');
        this.currentStudySession = new StudySessionEngine(exam, cards, progressList, SessionMode.REVIEW_ALL);
      } else {
        this.showToast('All cards completed for this phase! You can advance to the next phase.', 'success');
        return;
      }
    }

    // Auto-save active session state
    this.savePausedSession(this.currentStudySession);

    // Set UI Meta
    const studyOverlay = document.getElementById('study-view');
    document.getElementById('study-exam-title').textContent = exam.name;

    const phaseBadge = document.getElementById('study-phase-badge');
    if (mode === SessionMode.REVIEW_ALL) {
      phaseBadge.textContent = 'Review All';
    } else if (mode === SessionMode.REVIEW_WEAK) {
      phaseBadge.textContent = 'Weak Cards Target';
    } else {
      const names = {
        1: 'Phase 1: Diagnostic',
        2: 'Phase 2: Reinforcement',
        3: 'Phase 3: Final 6-Stage'
      };
      phaseBadge.textContent = names[exam.currentPhase || 1];
    }

    studyOverlay.classList.remove('hidden');
    this.renderCurrentStudyCard();

    if (resumeState) {
      this.showToast(`Resumed session at card ${this.currentStudySession.currentIndex + 1} of ${this.currentStudySession.queue.length}.`, 'info');
    }
  }

  /**
   * Updates the phase badge in the study overlay to reflect the current phase.
   */
  updateStudyPhaseBadge() {
    const phaseBadge = document.getElementById('study-phase-badge');
    if (!this.currentStudySession) return;
    const session = this.currentStudySession;
    if (session.mode === SessionMode.REVIEW_ALL) {
      phaseBadge.textContent = 'Review All';
    } else if (session.mode === SessionMode.REVIEW_WEAK) {
      phaseBadge.textContent = 'Weak Cards Target';
    } else {
      const names = {
        1: 'Phase 1: Diagnostic',
        2: 'Phase 2: Reinforcement',
        3: 'Phase 3: Final 6-Stage'
      };
      phaseBadge.textContent = names[session.phase] || `Phase ${session.phase}`;
    }
  }

  renderCurrentStudyCard() {
    if (!this.currentStudySession) return;

    // Check if a phase just completed and auto-transition is needed
    if (this.currentStudySession.phaseJustCompleted) {
      this.handlePhaseAutoTransition();
      return;
    }

    if (this.currentStudySession.isComplete()) {
      this.finishStudySession(false);
      return;
    }

    const card = this.currentStudySession.getCurrentCard();
    if (!card) {
      this.finishStudySession(false);
      return;
    }

    // Update Undo button state
    const undoBtn = document.getElementById('btn-study-undo');
    if (undoBtn) {
      undoBtn.disabled = !this.currentStudySession.canUndo();
    }

    const stats = this.currentStudySession.getProgressStats();
    document.getElementById('study-progress-fill').style.width = `${stats.percent}%`;
    document.getElementById('study-progress-text').textContent = `${stats.current} / ${stats.total}`;

    const cardTypeBadge = document.getElementById('study-card-type');
    const frontTextEl = document.getElementById('study-front-text');
    const backTextEl = document.getElementById('study-back-text');
    const suppPreEl = document.getElementById('study-card-supp-pre');
    const suppPostEl = document.getElementById('study-card-supp-post');

    suppPreEl.classList.add('hidden');
    suppPostEl.classList.add('hidden');

    if (card.cardType === CardType.CLOZE) {
      cardTypeBadge.textContent = `Cloze Deletion [c${card.clozeData.targetIndex}]`;
      frontTextEl.innerHTML = ClozeParser.renderQuestion(card.clozeData.rawText, card.clozeData.targetIndex);
      backTextEl.innerHTML = ClozeParser.renderAnswer(card.clozeData.rawText, card.clozeData.targetIndex);
    } else {
      cardTypeBadge.textContent = 'Basic Card';
      frontTextEl.textContent = card.front;
      backTextEl.textContent = card.back;
    }

    // Supplementary notes
    if (card.supplementaryFields && card.supplementaryFields.length > 0) {
      const suppHtml = card.supplementaryFields
        .map((f) => `<div><strong>${CardManager.escape(f.label)}:</strong> ${CardManager.escape(f.value)}</div>`)
        .join('');
      suppPostEl.innerHTML = suppHtml;
    }

    // Toggle reveal / rating controls depending on whether answer is revealed
    if (this.currentStudySession.isAnswerRevealed) {
      document.getElementById('study-card-back-wrapper').classList.remove('hidden');
      document.getElementById('study-reveal-controls').classList.add('hidden');
      document.getElementById('study-rating-controls').classList.remove('hidden');
      if (card.supplementaryFields && card.supplementaryFields.length > 0) {
        suppPostEl.classList.remove('hidden');
      }
    } else {
      document.getElementById('study-reveal-controls').classList.remove('hidden');
      document.getElementById('study-rating-controls').classList.add('hidden');
      document.getElementById('study-card-back-wrapper').classList.add('hidden');
    }
  }

  revealCurrentCardAnswer() {
    if (!this.currentStudySession) return;
    this.currentStudySession.revealAnswer();

    document.getElementById('study-card-back-wrapper').classList.remove('hidden');
    document.getElementById('study-reveal-controls').classList.add('hidden');
    document.getElementById('study-rating-controls').classList.remove('hidden');

    const card = this.currentStudySession.getCurrentCard();
    if (card && card.supplementaryFields && card.supplementaryFields.length > 0) {
      document.getElementById('study-card-supp-post').classList.remove('hidden');
    }
  }

  submitStudyRating(result) {
    if (!this.currentStudySession) return;

    const outcome = this.currentStudySession.submitResult(result);
    // Auto save on every answer
    this.savePausedSession(this.currentStudySession);
    this.renderCurrentStudyCard();
  }

  undoStudyRating() {
    if (!this.currentStudySession || !this.currentStudySession.canUndo()) return;

    const res = this.currentStudySession.undo();
    if (res) {
      this.savePausedSession(this.currentStudySession);
      this.renderCurrentStudyCard();
      this.showToast('Undid previous card rating. Select your answer again.', 'info');
    }
  }

  /**
   * Handles automatic transition between phases (Phase 1→2, Phase 2→3).
   * Shows a brief transition screen, saves progress, and continues.
   */
  async handlePhaseAutoTransition() {
    const session = this.currentStudySession;
    if (!session) return;

    const completedPhase = session.completedPhase;
    const phaseNames = {
      1: 'Phase 1: Diagnostic',
      2: 'Phase 2: Reinforcement',
      3: 'Phase 3: Final 6-Stage'
    };
    const completedName = phaseNames[completedPhase] || `Phase ${completedPhase}`;

    // Save progress to DB before transitioning
    try {
      await db.saveCardProgressBulk(session.getUpdatedProgressList());
    } catch (err) {
      console.error('Failed to save progress during phase transition:', err);
    }

    // Perform engine-level transition
    const transitioned = session.transitionToNextPhase();

    if (!transitioned) {
      // Phase 3 completed — end the session
      this.finishStudySession(false);
      return;
    }

    // Save new exam phase to DB
    try {
      await db.saveExam(session.exam);
    } catch (err) {
      console.error('Failed to save exam phase:', err);
    }

    const nextName = phaseNames[session.phase] || `Phase ${session.phase}`;

    // Update phase badge
    this.updateStudyPhaseBadge();

    // Auto-save the new state
    this.savePausedSession(session);

    // Check if the new phase has any cards
    if (session.queue.length === 0) {
      // No cards for this phase — try transitioning again
      session.phaseJustCompleted = true;
      session.completedPhase = session.phase;
      this.showToast(`${nextName} has no cards. Advancing...`, 'info');
      setTimeout(() => this.renderCurrentStudyCard(), 500);
      return;
    }

    // Show transition toast and continue
    this.showToast(`${completedName} complete! Moving to ${nextName} (${session.queue.length} cards).`, 'success');
    this.renderCurrentStudyCard();
  }

  // --- Session Completion & Save Confirmation (Section 6.2) ---
  async finishStudySession(interrupted = false) {
    const session = this.currentStudySession;
    if (!session) return;

    // Clear paused session from localStorage when completing normally
    if (!interrupted) {
      this.clearPausedSession(session.exam.id);
    }

    // Hide study screen
    document.getElementById('study-view').classList.add('hidden');

    // Show completion modal
    const completionModal = document.getElementById('modal-completion');
    completionModal.classList.add('no-backdrop-close');
    this.openModal(completionModal);

    const saveStatusBox = document.getElementById('completion-save-status');
    const saveStatusText = document.getElementById('save-status-text');
    const doneBtn = document.getElementById('btn-completion-done');
    const timerNote = document.getElementById('comp-timer-note');

    saveStatusBox.className = 'save-status-box status-saving';
    saveStatusText.textContent = 'Saving study progress to database...';
    doneBtn.disabled = true;

    // Set stats
    const stats = session.getProgressStats();
    document.getElementById('comp-stat-confident').textContent = stats.confidentCount;
    document.getElementById('comp-stat-uncertain').textContent = stats.uncertainCount;
    document.getElementById('comp-stat-incorrect').textContent = stats.incorrectCount;

    // Floating background words
    const floatContainer = document.getElementById('completion-float-words');
    floatContainer.innerHTML = '';
    const sampleWords = session.cards.slice(0, 12).map((c) => c.front.slice(0, 16));
    sampleWords.forEach((word) => {
      const span = document.createElement('span');
      span.textContent = word;
      floatContainer.appendChild(span);
    });

    // Unresolved cards
    const unresolved = session.getUnresolvedCards();
    const unresBox = document.getElementById('completion-unresolved-box');
    if (unresolved.length > 0) {
      unresBox.classList.remove('hidden');
      document.getElementById('comp-unresolved-count').textContent = unresolved.length;
    } else {
      unresBox.classList.add('hidden');
    }

    // Persist to IndexedDB
    try {
      const sessionData = session.exportSessionData();
      if (interrupted) {
        sessionData.completionStatus = 'interrupted';
      }
      const updatedProgress = session.getUpdatedProgressList();

      await db.saveStudySession(sessionData);
      await db.saveCardProgressBulk(updatedProgress);

      saveStatusBox.className = 'save-status-box status-saved';
      saveStatusText.textContent = '✓ Progress safely persisted in local database!';
    } catch (err) {
      console.error('Save failed:', err);
      saveStatusBox.className = 'save-status-box status-error';
      saveStatusText.textContent = '⚠️ Save failed: ' + err.message;
    }

    // Enforce 3-second minimum hold (Section 6.2 requirement)
    let countdown = 3;
    timerNote.textContent = `Reviewing performance... (${countdown}s minimum display)`;

    const timer = setInterval(() => {
      countdown--;
      if (countdown > 0) {
        timerNote.textContent = `Reviewing performance... (${countdown}s minimum display)`;
      } else {
        clearInterval(timer);
        timerNote.textContent = 'Results verified. Ready to return!';
        doneBtn.disabled = false;
        completionModal.classList.remove('no-backdrop-close');
      }
    }, 1000);
  }

  // ================= 8. CARD MANAGEMENT & EDITING =================
  bindCardManagerEvents() {
    document.getElementById('btn-deck-add-card').addEventListener('click', () => {
      this.openCardEditModal(null, this.activeExamForManager.id);
    });

    document.getElementById('deck-search-input').addEventListener('input', (e) => {
      this.filterCardManagerList(e.target.value);
    });

    document.getElementById('edit-card-type').addEventListener('change', (e) => {
      const isCloze = e.target.value === 'cloze';
      const backGroup = document.getElementById('group-edit-back');
      const clozeHint = document.getElementById('hint-cloze-syntax');
      if (isCloze) {
        backGroup.classList.add('hidden');
        clozeHint.classList.remove('hidden');
      } else {
        backGroup.classList.remove('hidden');
        clozeHint.classList.add('hidden');
      }
    });

    document.getElementById('form-card-edit').addEventListener('submit', (e) => this.handleSaveCard(e));
  }

  async openCardManager(exam) {
    this.activeExamForManager = exam;
    document.getElementById('manager-exam-subtitle').textContent = `Exam: ${exam.name}`;
    document.getElementById('deck-search-input').value = '';

    await this.renderCardManagerList();
    this.openModal(document.getElementById('modal-card-manager'));
  }

  async renderCardManagerList(filterText = '') {
    const container = document.getElementById('deck-cards-table-container');
    const cards = await db.getCardsByExam(this.activeExamForManager.id);

    const filtered = cards.filter((c) => {
      if (!filterText) return true;
      const q = filterText.toLowerCase();
      return (c.front || '').toLowerCase().includes(q) || (c.back || '').toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state"><p>No cards match your filter or deck is empty.</p></div>`;
      return;
    }

    container.innerHTML = filtered.map((c) => `
      <div class="deck-card-row">
        <div class="deck-card-text">
          <div class="deck-card-front">${CardManager.escape(c.front)}</div>
          <div class="deck-card-back">${CardManager.escape(c.back || '[Cloze note]')}</div>
        </div>
        <div class="deck-card-actions">
          <button class="btn btn-secondary btn-sm" data-edit-card="${c.id}">Edit</button>
          <button class="btn btn-secondary btn-sm link-btn-danger" data-delete-card="${c.id}">Delete</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('[data-edit-card]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const cardId = e.currentTarget.dataset.editCard;
        const card = await db.getCard(cardId);
        if (card) this.openCardEditModal(card, this.activeExamForManager.id);
      });
    });

    container.querySelectorAll('[data-delete-card]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const cardId = e.currentTarget.dataset.deleteCard;
        const conf = confirm('Delete this card? History for this card will also be removed.');
        if (conf) {
          await db.deleteCard(cardId);
          this.showToast('Card deleted.', 'success');
          await this.renderCardManagerList(document.getElementById('deck-search-input').value);
          await this.reloadDashboard();
        }
      });
    });
  }

  filterCardManagerList(text) {
    this.renderCardManagerList(text);
  }

  openCardEditModal(card = null, examId) {
    const modal = document.getElementById('modal-card-edit');
    const form = document.getElementById('form-card-edit');
    form.reset();

    document.getElementById('edit-card-exam-id').value = examId;

    if (card) {
      document.getElementById('card-edit-modal-title').textContent = 'Edit Card';
      document.getElementById('edit-card-id').value = card.id;
      document.getElementById('edit-card-type').value = card.cardType || 'basic';
      document.getElementById('edit-card-front').value = card.front || '';
      document.getElementById('edit-card-back').value = card.back || '';

      const suppText = (card.supplementaryFields || []).map((f) => `${f.label}: ${f.value}`).join('; ');
      document.getElementById('edit-card-supplementary').value = suppText;
    } else {
      document.getElementById('card-edit-modal-title').textContent = 'Add Single Card';
      document.getElementById('edit-card-id').value = '';
      document.getElementById('edit-card-type').value = 'basic';
      document.getElementById('edit-card-front').value = '';
      document.getElementById('edit-card-back').value = '';
      document.getElementById('edit-card-supplementary').value = '';
    }

    document.getElementById('edit-card-type').dispatchEvent(new Event('change'));
    this.openModal(modal);
  }

  async handleSaveCard(e) {
    e.preventDefault();
    const id = document.getElementById('edit-card-id').value;
    const examId = document.getElementById('edit-card-exam-id').value;
    const cardType = document.getElementById('edit-card-type').value;
    const front = document.getElementById('edit-card-front').value.trim();
    const back = document.getElementById('edit-card-back').value.trim();
    const suppStr = document.getElementById('edit-card-supplementary').value.trim();

    const supplementaryFields = suppStr ? [{ label: 'Note', value: suppStr }] : [];

    let cardObj;
    if (cardType === CardType.CLOZE) {
      const generated = CardManager.createClozeCardsFromNote({
        examId,
        text: front,
        supplementaryFields
      });
      cardObj = generated[0];
      if (id) cardObj.id = id;
    } else {
      cardObj = CardManager.createBasicCard({
        examId,
        front,
        back,
        supplementaryFields,
        id: id || null
      });
    }

    const val = CardManager.validateCard(cardObj);
    if (!val.valid) {
      this.showToast('Validation error: ' + val.errors.join('; '), 'error');
      return;
    }

    try {
      await db.saveCard(cardObj);
      this.closeModal(document.getElementById('modal-card-edit'));
      this.showToast('Card saved successfully!', 'success');
      await this.renderCardManagerList(document.getElementById('deck-search-input').value);
      await this.reloadDashboard();
    } catch (err) {
      this.showToast('Error saving card: ' + err.message, 'error');
    }
  }

  // ================= 10. BACKUP & RESTORE =================
  bindBackupEvents() {
    // Open backup modal
    document.getElementById('btn-backup-open').addEventListener('click', () => {
      this.openModal(document.getElementById('modal-backup'));
    });
    document.getElementById('btn-footer-backup').addEventListener('click', () => {
      this.openModal(document.getElementById('modal-backup'));
    });

    // Export JSON
    document.getElementById('btn-export-backup').addEventListener('click', async () => {
      try {
        await BackupManager.exportBackup();
        this.showToast('Backup exported and downloaded!', 'success');
      } catch (err) {
        this.showToast(err.message, 'error');
      }
    });

    // File choose for restore
    const restoreInput = document.getElementById('backup-file-input');
    const restoreChooseBtn = document.getElementById('btn-choose-backup-file');
    restoreChooseBtn.addEventListener('click', () => restoreInput.click());

    restoreInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      document.getElementById('backup-selected-name').textContent = file.name;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const val = BackupManager.validateBackup(json);

        const summaryBox = document.getElementById('backup-validate-summary');
        const optionsBox = document.getElementById('restore-options');

        if (!val.valid) {
          summaryBox.innerHTML = `<span style="color: var(--danger);">Invalid backup file:</span><br>${val.errors.join('<br>')}`;
          summaryBox.classList.remove('hidden');
          optionsBox.classList.add('hidden');
        } else {
          this.pendingRestoreData = json;
          summaryBox.innerHTML = `
            <span style="color: var(--success); font-weight: 600;">Valid LastLap Backup</span><br>
            • ${val.counts.exams} Exams<br>
            • ${val.counts.cards} Cards<br>
            • ${val.counts.progress} Progress Records<br>
            • ${val.counts.sessions} Study Sessions
          `;
          summaryBox.classList.remove('hidden');
          optionsBox.classList.remove('hidden');
        }
      } catch (err) {
        this.showToast('JSON parse error: ' + err.message, 'error');
      }
    });

    // Execute restore
    document.getElementById('btn-execute-restore').addEventListener('click', async () => {
      if (!this.pendingRestoreData) return;

      const mode = document.querySelector('input[name="restore-mode"]:checked').value;
      const isReplace = mode === 'replace';

      const conf = confirm(
        isReplace
          ? 'WARNING: This will replace all existing exams and cards with the backup file. Continue?'
          : 'Merge this backup with existing database?'
      );
      if (!conf) return;

      try {
        await BackupManager.restoreBackup(this.pendingRestoreData, isReplace);
        this.closeModal(document.getElementById('modal-backup'));
        this.showToast('Database successfully restored!', 'success');
        await this.reloadDashboard();
      } catch (err) {
        this.showToast('Restore failed: ' + err.message, 'error');
      }
    });
  }

  // ================= UTILITIES & HELPERS =================
  openModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }

  closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 260);
    }, 3500);
  }
}

// Instantiate and start app on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
