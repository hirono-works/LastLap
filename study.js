/**
 * study.js — Three-Phase Study Engine and Review Sessions for LastLap
 * Implements Sections 6 & 7 of PROJECT_SPEC.md
 *
 * Phase 1: Diagnostic — sort cards into "confident" (→Phase 3) vs "needs work" (→Phase 2)
 * Phase 2: Reinforcement — drill until 3 consecutive "confident", with spaced intervals
 * Phase 3: Final 6-Stage Review
 */

const ReviewResult = {
  CONFIDENT: 'confident',       // "Confidently Remembered"
  UNCERTAIN: 'uncertain',       // "Correct but Uncertain"
  INCORRECT: 'incorrect'        // "Incorrect or Could Not Recall"
};

const StudyPhase = {
  PHASE_1: 1, // Whole-Deck Diagnostic Review
  PHASE_2: 2, // Weak-Card Reinforcement
  PHASE_3: 3  // Final Review
};

const SessionMode = {
  PHASE: 'phase',
  REVIEW_ALL: 'review_all',
  REVIEW_WEAK: 'review_weak'
};

class StudySessionEngine {
  constructor(exam, cards, progressList, mode = SessionMode.PHASE, resumeState = null) {
    this.exam = exam;
    this.cards = cards;
    // Map of cardId -> progress object
    this.progressMap = new Map();
    progressList.forEach((p) => this.progressMap.set(p.cardId, { ...p }));

    this.mode = mode;
    this.phase = exam.currentPhase || StudyPhase.PHASE_1;

    // Queue of cardIds to review in this session
    this.queue = [];
    this.currentIndex = 0;
    this.currentCard = null;

    // Session-specific tracking
    this.sessionId = generateId();
    this.startedAt = new Date().toISOString();
    this.reviewedCardIds = [];
    this.sessionResults = []; // [{ cardId, result, timestamp, previousConsecutive }]
    this.isAnswerRevealed = false;
    this.history = []; // History stack for undo

    // Phase 1 routing results — tracks where each card goes after Phase 1
    // { cardId: 'phase3' | 'phase2', phase1Result: result }
    this.phase1Routing = {};

    // Phase 3 sub-stage tracking if applicable
    this.phase3Stage = 1;
    this.phase3StageCards = {
      1: [], // Hard Phase 2 cards (more difficult from Phase 2)
      2: [], // Easy Phase 2 cards (easier from Phase 2)
      3: [], // Phase 1 confident cards (went directly to Phase 3)
      4: [], // Cards missed in Phase 3 stages 1-3
      5: [], // Cards missed in stage 4 retest
      6: []  // Final remaining weak cards
    };

    // Flag: signals that the current phase just completed and a transition is needed
    this.phaseJustCompleted = false;
    // The phase that was completed (used by app.js to drive transition)
    this.completedPhase = null;

    if (resumeState) {
      this.restoreFromState(resumeState);
    } else {
      this.initializeQueue();
    }
  }

  /**
   * Restores session state from saved snapshot
   */
  restoreFromState(state) {
    if (state.sessionId) this.sessionId = state.sessionId;
    if (state.startedAt) this.startedAt = state.startedAt;
    if (state.mode) this.mode = state.mode;
    if (state.phase !== undefined) this.phase = state.phase;
    if (Array.isArray(state.queue)) this.queue = [...state.queue];
    if (typeof state.currentIndex === 'number') this.currentIndex = state.currentIndex;
    if (Array.isArray(state.reviewedCardIds)) this.reviewedCardIds = [...state.reviewedCardIds];
    if (Array.isArray(state.sessionResults)) this.sessionResults = [...state.sessionResults];
    if (state.phase3Stage) this.phase3Stage = state.phase3Stage;
    if (state.phase3StageCards) this.phase3StageCards = JSON.parse(JSON.stringify(state.phase3StageCards));
    if (state.isAnswerRevealed !== undefined) this.isAnswerRevealed = !!state.isAnswerRevealed;
    if (Array.isArray(state.history)) this.history = JSON.parse(JSON.stringify(state.history));
    if (state.phase1Routing) this.phase1Routing = JSON.parse(JSON.stringify(state.phase1Routing));
  }

  /**
   * Exports full session state for resuming later
   */
  exportState() {
    return {
      sessionId: this.sessionId,
      examId: this.exam.id,
      phase: this.phase,
      mode: this.mode,
      startedAt: this.startedAt,
      savedAt: new Date().toISOString(),
      queue: [...this.queue],
      currentIndex: this.currentIndex,
      reviewedCardIds: [...this.reviewedCardIds],
      sessionResults: [...this.sessionResults],
      phase3Stage: this.phase3Stage,
      phase3StageCards: JSON.parse(JSON.stringify(this.phase3StageCards)),
      isAnswerRevealed: this.isAnswerRevealed,
      history: JSON.parse(JSON.stringify(this.history)),
      phase1Routing: JSON.parse(JSON.stringify(this.phase1Routing))
    };
  }

  /**
   * Builds the study queue according to current phase or mode.
   */
  initializeQueue() {
    if (this.mode === SessionMode.REVIEW_ALL) {
      // Review All: randomize all cards
      this.queue = this.shuffle(this.cards.map((c) => c.id));
      return;
    }

    if (this.mode === SessionMode.REVIEW_WEAK) {
      // Review Weak Cards:
      // Cards that are incorrect, uncertain, have low consecutive correct, or not mastered
      const weakCardIds = this.cards.filter((card) => {
        const prog = this.progressMap.get(card.id);
        if (!prog) return true; // Never studied
        if (prog.lastResult === ReviewResult.INCORRECT) return true;
        if (prog.lastResult === ReviewResult.UNCERTAIN) return true;
        if ((prog.consecutiveCorrect || 0) < 3) return true;
        return false;
      }).map((c) => c.id);

      this.queue = this.shuffle(weakCardIds.length > 0 ? weakCardIds : this.cards.map((c) => c.id));
      return;
    }

    // Phase-specific queuing
    switch (this.phase) {
      case StudyPhase.PHASE_1:
        // Whole-deck diagnostic review: all cards shuffled
        // Only include cards that haven't been routed yet (no progress from Phase 1)
        this.queue = this.shuffle(this.cards.map((c) => c.id));
        break;

      case StudyPhase.PHASE_2: {
        // Weak-Card Reinforcement:
        // Only cards that were NOT routed to Phase 3 during Phase 1
        // i.e. cards where Phase 1 result was uncertain or incorrect
        // Prioritize incorrect cards from Phase 1
        const incorrectCards = [];
        const uncertainCards = [];
        const otherCards = [];

        this.cards.forEach((card) => {
          const prog = this.progressMap.get(card.id);

          // Skip cards that were confident in Phase 1 (routed to Phase 3)
          if (prog && prog.phase1Result === ReviewResult.CONFIDENT) {
            return; // Skip — these go directly to Phase 3
          }

          // If card has already achieved provisional mastery in Phase 2, skip
          if (prog && prog.provisionalMastery) {
            return;
          }

          if (prog && prog.phase1Result === ReviewResult.INCORRECT) {
            incorrectCards.push(card.id);
          } else if (prog && prog.phase1Result === ReviewResult.UNCERTAIN) {
            uncertainCards.push(card.id);
          } else if (!prog) {
            otherCards.push(card.id);
          } else {
            // Cards with some progress but not yet mastered
            if ((prog.consecutiveCorrect || 0) < 3) {
              uncertainCards.push(card.id);
            }
          }
        });

        // Priority order: Incorrect from Phase 1 first, then uncertain, then others
        this.queue = [
          ...this.shuffle(incorrectCards),
          ...this.shuffle(uncertainCards),
          ...this.shuffle(otherCards)
        ];

        break;
      }

      case StudyPhase.PHASE_3:
        // Final Review — Set up 6-stage pipeline
        this.setupPhase3Stages();
        this.advancePhase3Stage(1);
        break;

      default:
        this.queue = this.shuffle(this.cards.map((c) => c.id));
    }
  }

  setupPhase3Stages() {
    const hardPhase2 = [];
    const easyPhase2 = [];
    const confidentPhase1 = [];

    this.cards.forEach((card) => {
      const prog = this.progressMap.get(card.id);
      if (!prog) {
        hardPhase2.push(card.id);
        return;
      }

      // Cards that were confident in Phase 1 (skipped Phase 2) → Stage 3
      if (prog.phase1Result === ReviewResult.CONFIDENT) {
        confidentPhase1.push(card.id);
      }
      // Cards from Phase 2: categorize by difficulty
      else if (prog.phase1Result === ReviewResult.INCORRECT || (prog.consecutiveCorrect || 0) < 2) {
        // More difficult cards from Phase 2 → Stage 1
        hardPhase2.push(card.id);
      } else {
        // Easier cards from Phase 2 → Stage 2
        easyPhase2.push(card.id);
      }
    });

    this.phase3StageCards[1] = this.shuffle(hardPhase2);
    this.phase3StageCards[2] = this.shuffle(easyPhase2);
    this.phase3StageCards[3] = this.shuffle(confidentPhase1);
    this.phase3StageCards[4] = [];
    this.phase3StageCards[5] = [];
    this.phase3StageCards[6] = [];
  }

  advancePhase3Stage(stageNumber) {
    this.phase3Stage = stageNumber;
    if (stageNumber > 6) {
      this.queue = [];
      return;
    }

    const cardsForStage = this.phase3StageCards[stageNumber] || [];
    if (cardsForStage.length === 0 && stageNumber < 6) {
      // Auto-advance to next stage if this stage is empty
      this.advancePhase3Stage(stageNumber + 1);
    } else {
      this.queue = [...cardsForStage];
      this.currentIndex = 0;
    }
  }

  getCurrentCard() {
    if (this.currentIndex >= this.queue.length) {
      if (this.phase === StudyPhase.PHASE_3 && this.phase3Stage < 6) {
        // Try next stage
        this.advancePhase3Stage(this.phase3Stage + 1);
        return this.getCurrentCard();
      }
      return null;
    }
    const cardId = this.queue[this.currentIndex];
    return this.cards.find((c) => c.id === cardId) || null;
  }

  revealAnswer() {
    this.isAnswerRevealed = true;
  }

  /**
   * Submits a review result for the current card.
   * Behavior differs by phase:
   *
   * Phase 1 (Diagnostic): Routes cards only. Confident → Phase 3, others → Phase 2.
   *   Does NOT record spaced-repetition progress (reviewCount, consecutiveCorrect stay 0).
   *
   * Phase 2 (Reinforcement): Tracks spaced repetition. 3 consecutive confident = mastery → Phase 3.
   *   Intervals: confident → 10min, then 1hr, then mastery. Incorrect → 1min re-queue.
   *   Uncertain resets consecutive but doesn't count as incorrect for scheduling.
   *
   * Phase 3 (Final Review): Stage forwarding for missed cards.
   */
  submitResult(result) {
    const card = this.getCurrentCard();
    if (!card) return null;

    const now = new Date();
    const prevProg = this.progressMap.get(card.id);
    const prevProgSnapshot = prevProg ? { ...prevProg } : null;

    const historyEntry = {
      currentIndex: this.currentIndex,
      cardId: card.id,
      previousProg: prevProgSnapshot,
      previousPhase1Routing: this.phase1Routing[card.id] || null,
      phase: this.phase,
      phase3Stage: this.phase3Stage,
      phase2InsertedIndex: null,
      phase3ForwardedStage: null
    };

    let prog = prevProg;
    if (!prog) {
      prog = {
        id: generateId(),
        cardId: card.id,
        examId: this.exam.id,
        reviewCount: 0,
        consecutiveCorrect: 0,
        lastResult: null,
        lastReviewedAt: null,
        nextReviewAt: null,
        phaseStatus: this.phase,
        phase1Result: null,
        provisionalMastery: false
      };
    } else {
      // Clone to avoid mutating old reference before saving
      prog = { ...prog };
    }

    const prevConsecutive = prog.consecutiveCorrect || 0;
    prog.lastReviewedAt = now.toISOString();
    prog.phaseStatus = this.phase;

    // ===== PHASE 1: DIAGNOSTIC ROUTING =====
    if (this.phase === StudyPhase.PHASE_1 && this.mode === SessionMode.PHASE) {
      // Phase 1 is purely diagnostic — record the result for routing only
      prog.phase1Result = result;
      prog.lastResult = result;
      // Do NOT update reviewCount, consecutiveCorrect, or scheduling
      // These are left at initial values so Phase 2 starts fresh

      if (result === ReviewResult.CONFIDENT) {
        this.phase1Routing[card.id] = 'phase3';
      } else {
        this.phase1Routing[card.id] = 'phase2';
      }

    // ===== PHASE 2: REINFORCEMENT WITH SPACED INTERVALS =====
    } else if (this.phase === StudyPhase.PHASE_2 && this.mode === SessionMode.PHASE) {
      prog.reviewCount = (prog.reviewCount || 0) + 1;
      prog.lastResult = result;

      if (result === ReviewResult.CONFIDENT) {
        prog.consecutiveCorrect = prevConsecutive + 1;

        if (prog.consecutiveCorrect === 1) {
          // First confident → schedule review in 10 minutes
          prog.nextReviewAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
        } else if (prog.consecutiveCorrect === 2) {
          // Second consecutive confident → schedule review in 1 hour
          prog.nextReviewAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
        } else if (prog.consecutiveCorrect >= 3) {
          // Third consecutive confident → provisional mastery, move to Phase 3
          prog.provisionalMastery = true;
          prog.nextReviewAt = null;
        }
      } else if (result === ReviewResult.UNCERTAIN) {
        // Uncertain: reset consecutive count, schedule 10 mins
        prog.consecutiveCorrect = 0;
        prog.provisionalMastery = false;
        prog.nextReviewAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

        // Re-insert into queue for another attempt
        const reinsertPos = Math.min(this.queue.length, this.currentIndex + 4);
        this.queue.splice(reinsertPos, 0, card.id);
        historyEntry.phase2InsertedIndex = reinsertPos;
      } else {
        // INCORRECT: reset consecutive count, schedule 1 minute re-queue
        prog.consecutiveCorrect = 0;
        prog.provisionalMastery = false;
        prog.nextReviewAt = new Date(now.getTime() + 1 * 60 * 1000).toISOString();

        // Re-insert into queue sooner (show again after ~3 cards)
        const reinsertPos = Math.min(this.queue.length, this.currentIndex + 3);
        this.queue.splice(reinsertPos, 0, card.id);
        historyEntry.phase2InsertedIndex = reinsertPos;
      }

    // ===== PHASE 3: FINAL REVIEW WITH STAGE FORWARDING =====
    } else if (this.phase === StudyPhase.PHASE_3 && this.mode === SessionMode.PHASE) {
      prog.reviewCount = (prog.reviewCount || 0) + 1;
      prog.lastResult = result;

      if (result === ReviewResult.CONFIDENT) {
        prog.consecutiveCorrect = prevConsecutive + 1;
        prog.nextReviewAt = null;
      } else {
        prog.consecutiveCorrect = 0;
        prog.provisionalMastery = false;

        // Forward missed cards to later stages
        let stageTarget = null;
        if (this.phase3Stage === 1 || this.phase3Stage === 2 || this.phase3Stage === 3) {
          stageTarget = 4;
        } else if (this.phase3Stage === 4) {
          stageTarget = 5;
        } else if (this.phase3Stage === 5) {
          stageTarget = 6;
        }
        if (stageTarget) {
          this.phase3StageCards[stageTarget].push(card.id);
          historyEntry.phase3ForwardedStage = stageTarget;
        }
      }

    // ===== REVIEW MODES (non-phase) =====
    } else {
      prog.reviewCount = (prog.reviewCount || 0) + 1;
      prog.lastResult = result;

      if (result === ReviewResult.CONFIDENT) {
        prog.consecutiveCorrect = prevConsecutive + 1;
        if (prog.consecutiveCorrect >= 3) {
          prog.provisionalMastery = true;
          prog.nextReviewAt = null;
        } else {
          prog.nextReviewAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
        }
      } else if (result === ReviewResult.UNCERTAIN) {
        prog.consecutiveCorrect = Math.max(0, prevConsecutive);
        prog.nextReviewAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
        prog.provisionalMastery = false;
      } else {
        prog.consecutiveCorrect = 0;
        prog.provisionalMastery = false;
        prog.nextReviewAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      }
    }

    this.progressMap.set(card.id, prog);
    this.reviewedCardIds.push(card.id);
    this.sessionResults.push({
      cardId: card.id,
      result,
      timestamp: now.toISOString(),
      previousConsecutive: prevConsecutive
    });
    this.history.push(historyEntry);

    // Advance index
    this.currentIndex++;
    this.isAnswerRevealed = false;

    // Check if the current phase just completed (for auto-transition)
    this.phaseJustCompleted = false;
    this.completedPhase = null;
    if (this.mode === SessionMode.PHASE && this.isPhaseComplete()) {
      this.phaseJustCompleted = true;
      this.completedPhase = this.phase;
    }

    return {
      card,
      prog,
      result,
      isSessionComplete: this.isComplete(),
      phaseJustCompleted: this.phaseJustCompleted,
      completedPhase: this.completedPhase
    };
  }

  /**
   * Checks whether an undo operation can be performed
   */
  canUndo() {
    return Array.isArray(this.history) && this.history.length > 0;
  }

  /**
   * Undoes the last card review action and restores prior state
   */
  undo() {
    if (!this.canUndo()) return null;

    const entry = this.history.pop();
    this.currentIndex = entry.currentIndex;

    // Restore card progress in map
    if (entry.previousProg) {
      this.progressMap.set(entry.cardId, { ...entry.previousProg });
    } else {
      this.progressMap.delete(entry.cardId);
    }

    // Restore phase1 routing
    if (entry.previousPhase1Routing !== undefined) {
      if (entry.previousPhase1Routing === null) {
        delete this.phase1Routing[entry.cardId];
      } else {
        this.phase1Routing[entry.cardId] = entry.previousPhase1Routing;
      }
    }

    // Remove last session result
    if (this.sessionResults.length > 0) {
      this.sessionResults.pop();
    }

    // Remove from reviewedCardIds
    const revIdx = this.reviewedCardIds.lastIndexOf(entry.cardId);
    if (revIdx !== -1) {
      this.reviewedCardIds.splice(revIdx, 1);
    }

    // Revert Phase 2 queue reinsertion if any
    if (entry.phase2InsertedIndex !== null && entry.phase2InsertedIndex < this.queue.length) {
      this.queue.splice(entry.phase2InsertedIndex, 1);
    }

    // Revert Phase 3 stage forwarding if any
    if (entry.phase3ForwardedStage !== null) {
      const stageCards = this.phase3StageCards[entry.phase3ForwardedStage];
      if (stageCards) {
        const fIdx = stageCards.lastIndexOf(entry.cardId);
        if (fIdx !== -1) stageCards.splice(fIdx, 1);
      }
    }

    if (entry.phase3Stage !== undefined) {
      this.phase3Stage = entry.phase3Stage;
    }

    // Reset phase completion flag
    this.phaseJustCompleted = false;
    this.completedPhase = null;

    // When undone, place the card back with answer revealed so user can immediately re-rate
    this.isAnswerRevealed = true;

    return {
      card: this.getCurrentCard(),
      prog: this.progressMap.get(entry.cardId) || null,
      historyLength: this.history.length
    };
  }

  /**
   * Checks if the current phase's queue is exhausted.
   * For Phase 2, also checks that all cards have achieved mastery.
   */
  isPhaseComplete() {
    if (this.phase === StudyPhase.PHASE_1) {
      return this.currentIndex >= this.queue.length;
    }

    if (this.phase === StudyPhase.PHASE_2) {
      // Phase 2 is complete when queue is exhausted
      // (cards that haven't reached mastery are re-inserted into the queue)
      return this.currentIndex >= this.queue.length;
    }

    if (this.phase === StudyPhase.PHASE_3) {
      // Phase 3 complete when all 6 stages are done
      return this.currentIndex >= this.queue.length && this.phase3Stage >= 6;
    }

    return this.currentIndex >= this.queue.length;
  }

  /**
   * isComplete signals end of the entire session.
   * For PHASE mode, a phase completing triggers transition, not session end (unless Phase 3 done).
   */
  isComplete() {
    if (this.mode !== SessionMode.PHASE) {
      return this.currentIndex >= this.queue.length;
    }

    // In PHASE mode, only Phase 3 completion ends the session
    if (this.phase === StudyPhase.PHASE_3) {
      return this.currentIndex >= this.queue.length && this.phase3Stage >= 6;
    }

    // For Phase 1 & 2 in PHASE mode: phase completion triggers auto-transition,
    // which is handled by phaseJustCompleted flag. The session isn't "complete" yet.
    // However, if transition isn't possible, we do mark it complete.
    return false;
  }

  /**
   * Transitions the engine to the next phase within the same session.
   * Called by app.js when phaseJustCompleted is true.
   */
  transitionToNextPhase() {
    const previousPhase = this.phase;

    if (previousPhase === StudyPhase.PHASE_1) {
      this.phase = StudyPhase.PHASE_2;
    } else if (previousPhase === StudyPhase.PHASE_2) {
      this.phase = StudyPhase.PHASE_3;
    } else {
      // Phase 3 → session complete, no transition
      return false;
    }

    // Update exam
    this.exam.currentPhase = this.phase;

    // Reset session tracking for the new phase
    this.currentIndex = 0;
    this.isAnswerRevealed = false;
    this.phaseJustCompleted = false;
    this.completedPhase = null;
    // Keep history, sessionResults, reviewedCardIds — they're cumulative for the session

    // Build new queue for the next phase
    this.initializeQueue();

    return true;
  }

  getProgressStats() {
    const total = this.queue.length;
    const current = Math.min(this.currentIndex + 1, total);
    const confidentCount = this.sessionResults.filter((r) => r.result === ReviewResult.CONFIDENT).length;
    const uncertainCount = this.sessionResults.filter((r) => r.result === ReviewResult.UNCERTAIN).length;
    const incorrectCount = this.sessionResults.filter((r) => r.result === ReviewResult.INCORRECT).length;

    return {
      current,
      total,
      percent: total > 0 ? Math.round((this.currentIndex / total) * 100) : 100,
      confidentCount,
      uncertainCount,
      incorrectCount,
      phase3Stage: this.phase === StudyPhase.PHASE_3 ? this.phase3Stage : null
    };
  }

  /**
   * Finalizes session object for persistence in IndexedDB.
   */
  exportSessionData() {
    return {
      id: this.sessionId,
      examId: this.exam.id,
      phase: this.phase,
      mode: this.mode,
      startedAt: this.startedAt,
      completedAt: new Date().toISOString(),
      reviewedCardIds: Array.from(new Set(this.reviewedCardIds)),
      sessionResults: this.sessionResults,
      completionStatus: 'completed'
    };
  }

  /**
   * Gets updated progress objects ready for bulk saving.
   */
  getUpdatedProgressList() {
    return Array.from(this.progressMap.values());
  }

  /**
   * Unresolved cards summary for session completion screen.
   */
  getUnresolvedCards() {
    return this.cards.filter((card) => {
      const p = this.progressMap.get(card.id);
      return !p || p.lastResult === ReviewResult.INCORRECT || (p.consecutiveCorrect || 0) < 3;
    });
  }

  shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
