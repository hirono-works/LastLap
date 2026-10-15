/**
 * study.js — Three-Phase Study Engine and Review Sessions for LastLap
 * Implements Sections 6 & 7 of PROJECT_SPEC.md
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
  constructor(exam, cards, progressList, mode = SessionMode.PHASE) {
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

    // Phase 3 sub-stage tracking if applicable
    this.phase3Stage = 1;
    this.phase3StageCards = {
      1: [], // Hard Phase 2 cards
      2: [], // Easy Phase 2 cards
      3: [], // Phase 1 confident cards
      4: [], // Cards missed in Phase 3
      5: [], // Cards missed in stage 4 retest
      6: []  // Final remaining weak cards
    };

    this.initializeQueue();
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
        this.queue = this.shuffle(this.cards.map((c) => c.id));
        break;

      case StudyPhase.PHASE_2: {
        // Weak-Card Reinforcement:
        // Prioritize cards marked Incorrect or Uncertain in Phase 1
        // or cards where consecutiveCorrect < 3
        const now = Date.now();
        const weakCards = [];
        const readyCards = [];
        const otherCards = [];

        this.cards.forEach((card) => {
          const prog = this.progressMap.get(card.id);
          if (!prog) {
            weakCards.push(card.id);
          } else if (prog.lastResult === ReviewResult.INCORRECT || prog.lastResult === ReviewResult.UNCERTAIN) {
            // Check if due for review based on nextReviewAt
            if (prog.nextReviewAt && new Date(prog.nextReviewAt).getTime() > now) {
              // Scheduled for later, but prioritize if no other cards
              otherCards.push(card.id);
            } else {
              readyCards.push(card.id);
            }
          } else if ((prog.consecutiveCorrect || 0) < 3) {
            readyCards.push(card.id);
          } else {
            // Already provisionally mastered
            otherCards.push(card.id);
          }
        });

        // Priority order: Ready weak cards -> unstudied -> other cards
        this.queue = [
          ...this.shuffle(readyCards),
          ...this.shuffle(weakCards),
          ...this.shuffle(otherCards)
        ];

        // If all are mastered, queue all to allow ongoing reinforcement
        if (this.queue.length === 0) {
          this.queue = this.shuffle(this.cards.map((c) => c.id));
        }
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

      // Check Phase 1 results vs Phase 2
      if (prog.lastResult === ReviewResult.CONFIDENT && (prog.consecutiveCorrect || 0) >= 3) {
        confidentPhase1.push(card.id);
      } else if (prog.lastResult === ReviewResult.INCORRECT || (prog.consecutiveCorrect || 0) < 2) {
        hardPhase2.push(card.id);
      } else {
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
   * Updates card progress according to rules.
   */
  submitResult(result) {
    const card = this.getCurrentCard();
    if (!card) return null;

    const now = new Date();
    let prog = this.progressMap.get(card.id);
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
        provisionalMastery: false
      };
    }

    const prevConsecutive = prog.consecutiveCorrect || 0;
    prog.reviewCount = (prog.reviewCount || 0) + 1;
    prog.lastReviewedAt = now.toISOString();
    prog.lastResult = result;
    prog.phaseStatus = this.phase;

    // Apply Phase 2 and general repetition rules
    if (result === ReviewResult.CONFIDENT) {
      prog.consecutiveCorrect = prevConsecutive + 1;

      if (prog.consecutiveCorrect === 1) {
        // Schedule next review ~10 minutes later
        prog.nextReviewAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
      } else if (prog.consecutiveCorrect === 2) {
        // Schedule next review ~1 hour later
        prog.nextReviewAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      } else if (prog.consecutiveCorrect >= 3) {
        // Provisional mastery reached
        prog.provisionalMastery = true;
        prog.nextReviewAt = null;
      }
    } else if (result === ReviewResult.UNCERTAIN) {
      // Uncertain: does not increment consecutive count, treated as needing reinforcement
      prog.consecutiveCorrect = Math.max(0, prevConsecutive);
      // Scheduled 10 mins later for reinforcement
      prog.nextReviewAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
      prog.provisionalMastery = false;
    } else {
      // INCORRECT: resets consecutive count
      prog.consecutiveCorrect = 0;
      prog.provisionalMastery = false;
      prog.nextReviewAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

      // In Phase 2: re-insert into later position in current session queue
      if (this.phase === StudyPhase.PHASE_2 && this.mode === SessionMode.PHASE) {
        const reinsertPos = Math.min(this.queue.length, this.currentIndex + 4);
        this.queue.splice(reinsertPos, 0, card.id);
      }
    }

    // Phase 3 stage forwarding for missed cards
    if (this.phase === StudyPhase.PHASE_3 && this.mode === SessionMode.PHASE) {
      if (result === ReviewResult.INCORRECT || result === ReviewResult.UNCERTAIN) {
        if (this.phase3Stage === 1 || this.phase3Stage === 2 || this.phase3Stage === 3) {
          this.phase3StageCards[4].push(card.id);
        } else if (this.phase3Stage === 4) {
          this.phase3StageCards[5].push(card.id);
        } else if (this.phase3Stage === 5) {
          this.phase3StageCards[6].push(card.id);
        }
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

    // Advance index
    this.currentIndex++;
    this.isAnswerRevealed = false;

    return {
      card,
      prog,
      result,
      isSessionComplete: this.isComplete()
    };
  }

  isComplete() {
    if (this.phase === StudyPhase.PHASE_3 && this.mode === SessionMode.PHASE) {
      return this.currentIndex >= this.queue.length && this.phase3Stage >= 6;
    }
    return this.currentIndex >= this.queue.length;
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
