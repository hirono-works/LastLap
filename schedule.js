/**
 * schedule.js — Study schedule estimation and planning for LastLap
 * Implements Section 5 of PROJECT_SPEC.md
 */

const MasteryLevels = {
  NOT_STUDIED: { label: 'Not studied (0%)', factor: 0.95 },
  SLIGHTLY_LEARNED: { label: 'Slightly learned (~15%)', factor: 0.85 },
  HALF_LEARNED: { label: 'Half learned (~50%)', factor: 0.50 },
  MOSTLY_LEARNED: { label: 'Mostly learned (~80%)', factor: 0.20 },
  ALMOST_EVERYTHING: { label: 'Almost everything learned (~95%)', factor: 0.05 }
};

const ScheduleCalculator = {
  // Default parameters
  defaults: {
    cardsPerExam: 50,
    secondsPerCard: 20, // t
    reviewAllowance: 0.5, // r (50% extra time for repeats & retention)
    dailyMinutes: 30, // d (30 mins per day)
    masteryLevel: 'NOT_STUDIED'
  },

  /**
   * Calculates study schedule estimation.
   *
   * Formula:
   * M = mastery adjustment factor (proportion of material still needing heavy study)
   * T = (N * M * t / 60) * (1 + r) [Total estimated study minutes]
   * D = ceil(T / d) [Study days required]
   * Recommended Start Date = Exam Date - D days
   */
  calculate({
    examDate,
    numCards = 50,
    secondsPerCard = 20,
    reviewAllowance = 0.5,
    dailyMinutes = 30,
    masteryLevel = 'NOT_STUDIED'
  }) {
    const errors = [];
    const warnings = [];

    // Validations
    const N = Math.max(1, parseInt(numCards, 10) || 1);
    const t = Math.max(1, parseFloat(secondsPerCard) || 20);
    const r = Math.max(0, parseFloat(reviewAllowance) || 0);
    const d = Math.max(1, parseFloat(dailyMinutes) || 1);

    const masteryObj = MasteryLevels[masteryLevel] || MasteryLevels.NOT_STUDIED;
    const M = masteryObj.factor;

    // Calculation
    // Base minutes needed = (N * M * t) / 60
    const rawMinutes = (N * M * t) / 60;
    // Total minutes with review allowance
    const totalMinutes = rawMinutes * (1 + r);
    // Total days needed
    const requiredDays = Math.max(1, Math.ceil(totalMinutes / d));

    // Date calculations
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const targetDate = new Date(examDate);
    targetDate.setHours(0, 0, 0, 0);

    const isPast = targetDate < today;
    if (isPast) {
      warnings.push('The exam date is already in the past.');
    }

    // Days remaining until exam
    const diffTime = targetDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Recommended start date = targetDate - requiredDays
    const recStartDate = new Date(targetDate);
    recStartDate.setDate(recStartDate.getDate() - requiredDays);

    const startDiffDays = Math.ceil((recStartDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    let urgent = false;
    let requiredDailyIfTight = null;

    if (!isPast && startDiffDays < 0) {
      // Not enough days if sticking to 'd' minutes/day
      urgent = true;
      if (daysRemaining > 0) {
        requiredDailyIfTight = Math.ceil(totalMinutes / daysRemaining);
        warnings.push(
          `Recommended start date was ${Math.abs(startDiffDays)} day(s) ago! To be ready by exam day (${daysRemaining} day(s) left), you need ~${requiredDailyIfTight} min/day.`
        );
      } else {
        warnings.push('Exam is today! Intensive cramming session recommended.');
      }
    } else if (!isPast && startDiffDays === 0) {
      warnings.push('Recommended start date is TODAY! Begin Phase 1 diagnostic review right away.');
    }

    return {
      numCards: N,
      secondsPerCard: t,
      reviewAllowance: r,
      dailyMinutes: d,
      masteryLevel,
      masteryFactor: M,
      totalMinutes: Math.round(totalMinutes),
      totalHours: (totalMinutes / 60).toFixed(1),
      requiredDays,
      daysRemaining,
      recommendedStartDate: recStartDate.toISOString().split('T')[0],
      isPast,
      isUrgent: urgent,
      requiredDailyIfTight,
      warnings,
      assumptionsText: `Assumes ~${t}s per card, ${Math.round(M * 100)}% unlearned content factor (${masteryObj.label}), ${Math.round(r * 100)}% buffer for reinforcement reviews, and ${d} min/day study.`
    };
  }
};
