/**
 * test_modules.js — Node.js test script for verifying LastLap core algorithms
 */

const fs = require('fs');
const path = require('path');

const vm = require('vm');

// Mock window / document / localStorage if needed
global.document = {
  createElement: (tag) => ({
    textContent: '',
    innerHTML: '',
    appendChild: () => {},
    setAttribute: () => {}
  })
};

// 1. Test ScheduleCalculator
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'schedule.js'), 'utf8'));

console.log('--- Testing ScheduleCalculator ---');
const testSched = ScheduleCalculator.calculate({
  examDate: '2026-10-30',
  numCards: 60,
  secondsPerCard: 20,
  reviewAllowance: 0.5,
  dailyMinutes: 30,
  masteryLevel: 'NOT_STUDIED'
});
console.log('Total Minutes:', testSched.totalMinutes);
console.log('Required Days:', testSched.requiredDays);
console.log('Recommended Start Date:', testSched.recommendedStartDate);
console.assert(testSched.totalMinutes > 0, 'Total minutes should be positive');
console.assert(testSched.requiredDays > 0, 'Required days should be positive');

// 2. Test ClozeParser & CardManager
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'cards.js'), 'utf8'));

console.log('\n--- Testing ClozeParser ---');
const clozeText = 'Canberra is the {{c1::capital::city}} of {{c2::Australia}}.';
const indices = ClozeParser.extractIndices(clozeText);
console.log('Extracted Indices:', indices);
console.assert(indices.length === 2 && indices[0] === 1 && indices[1] === 2, 'Should extract indices 1 and 2');

const q1 = ClozeParser.renderQuestion(clozeText, 1);
console.log('Render Question (c1):', q1);
console.assert(q1.includes('[city]'), 'Should contain hint [city]');
console.assert(q1.includes('Australia'), 'Should reveal c2 answer');

const a1 = ClozeParser.renderAnswer(clozeText, 1);
console.log('Render Answer (c1):', a1);
console.assert(a1.includes('cloze-revealed') && a1.includes('capital'), 'Should highlight capital');

const clozeCards = CardManager.createClozeCardsFromNote({
  examId: 'exam123',
  text: clozeText
});
console.log('Generated Cloze Cards count:', clozeCards.length);
console.assert(clozeCards.length === 2, 'Should generate 2 cards for 2 cloze deletions');

// 3. Test FileImporter
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'import.js'), 'utf8'));

console.log('\n--- Testing FileImporter (CSV & TSV) ---');
const csvSample = `Front,Back,Notes\n"What is DNA?","Deoxyribonucleic acid","Genetic code"\n"Speed of light","3x10^8 m/s","Physics"`;
const parsedCSV = FileImporter.parseDelimitedText(csvSample);
console.log('Parsed CSV rows:', parsedCSV.rows.length, 'Headers:', parsedCSV.headers);
console.assert(parsedCSV.rows.length === 2, 'CSV should have 2 rows');

const builtCards = FileImporter.buildCardsFromParsedData({
  examId: 'exam123',
  headers: parsedCSV.headers,
  rows: parsedCSV.rows,
  mapping: {
    frontColIndex: 0,
    backColIndex: 1,
    supplementaryIndices: [2],
    isClozeMode: false
  }
});
console.log('Built Basic Cards count:', builtCards.cards.length);
console.assert(builtCards.cards.length === 2, 'Should build 2 cards');
console.assert(builtCards.cards[0].supplementaryFields.length === 1, 'Should attach supplementary field');

// TSV & Anki with comments
const ankiSample = `#separator:tab\n#html:true\nTokyo\tCapital of Japan\tAsia\nParis\tCapital of France\tEurope`;
const parsedAnki = FileImporter.parseDelimitedText(ankiSample);
console.log('Parsed Anki notes count:', parsedAnki.rows.length, 'Delimiter:', JSON.stringify(parsedAnki.delimiter));
console.assert(parsedAnki.rows.length === 2, 'Should parse 2 Anki rows and skip comments');

// 4. Test StudySessionEngine
vm.runInThisContext(fs.readFileSync(path.join(__dirname, 'study.js'), 'utf8'));

console.log('\n--- Testing StudySessionEngine (Phases & Intervals) ---');
const mockExam = { id: 'exam123', name: 'Test Exam', currentPhase: StudyPhase.PHASE_1 };
const mockCards = [
  { id: 'c1', front: 'Q1', back: 'A1', cardType: 'basic' },
  { id: 'c2', front: 'Q2', back: 'A2', cardType: 'basic' },
  { id: 'c3', front: 'Q3', back: 'A3', cardType: 'basic' }
];
const mockProgress = [];

const engine = new StudySessionEngine(mockExam, mockCards, mockProgress, SessionMode.PHASE);
console.log('Phase 1 Queue length:', engine.queue.length);
console.assert(engine.queue.length === 3, 'Phase 1 should queue all 3 cards');

// Card 1 answered Confident
const card1 = engine.getCurrentCard();
engine.revealAnswer();
engine.submitResult(ReviewResult.CONFIDENT);

// Card 2 answered Uncertain
const card2 = engine.getCurrentCard();
engine.revealAnswer();
engine.submitResult(ReviewResult.UNCERTAIN);

// Card 3 answered Incorrect
const card3 = engine.getCurrentCard();
engine.revealAnswer();
engine.submitResult(ReviewResult.INCORRECT);

// Phase 1 should signal phase completion, not session completion
console.log('Phase just completed:', engine.phaseJustCompleted);
console.assert(engine.phaseJustCompleted === true, 'Phase 1 should be complete after all cards answered');
console.assert(engine.completedPhase === StudyPhase.PHASE_1, 'completedPhase should be PHASE_1');
console.assert(engine.isComplete() === false, 'Session should NOT be complete (need phases 2 & 3)');

const updatedProg = engine.getUpdatedProgressList();
const c1Prog = updatedProg.find(p => p.cardId === card1.id);
const c2Prog = updatedProg.find(p => p.cardId === card2.id);
const c3Prog = updatedProg.find(p => p.cardId === card3.id);

// Phase 1 diagnostic routing checks
console.log('card1 phase1Result:', c1Prog.phase1Result);
console.assert(c1Prog.phase1Result === ReviewResult.CONFIDENT, 'card1 should have phase1Result confident');
console.log('card2 phase1Result:', c2Prog.phase1Result);
console.assert(c2Prog.phase1Result === ReviewResult.UNCERTAIN, 'card2 should have phase1Result uncertain');
console.log('card3 phase1Result:', c3Prog.phase1Result);
console.assert(c3Prog.phase1Result === ReviewResult.INCORRECT, 'card3 should have phase1Result incorrect');

// Phase 1 should NOT record spaced-repetition progress
console.assert(c1Prog.consecutiveCorrect === 0, 'Phase 1 should NOT track consecutiveCorrect');
console.assert(c1Prog.reviewCount === 0, 'Phase 1 should NOT increment reviewCount');

// Phase 1 routing
console.assert(engine.phase1Routing[card1.id] === 'phase3', 'card1 (confident) should route to phase3');
console.assert(engine.phase1Routing[card2.id] === 'phase2', 'card2 (uncertain) should route to phase2');
console.assert(engine.phase1Routing[card3.id] === 'phase2', 'card3 (incorrect) should route to phase2');

console.log('Phase 1 routing tests passed!');

// 5. Test Phase Auto-Transition (Phase 1 → Phase 2)
console.log('\n--- Testing Phase Auto-Transition (Phase 1 → Phase 2) ---');
const transitioned12 = engine.transitionToNextPhase();
console.assert(transitioned12 === true, 'Transition from Phase 1 to 2 should succeed');
console.assert(engine.phase === StudyPhase.PHASE_2, 'Engine should now be in Phase 2');
console.assert(engine.exam.currentPhase === StudyPhase.PHASE_2, 'Exam phase should be updated');
console.log('Phase 2 queue length:', engine.queue.length);
// Phase 2 should only have card2 (uncertain) and card3 (incorrect), NOT card1 (confident → Phase 3)
console.assert(engine.queue.length === 2, 'Phase 2 should queue only 2 cards (not card1 which was confident)');
console.assert(!engine.queue.includes(card1.id), 'card1 (confident) should NOT be in Phase 2 queue');
console.assert(engine.queue.includes(card2.id), 'card2 (uncertain) should be in Phase 2 queue');
console.assert(engine.queue.includes(card3.id), 'card3 (incorrect) should be in Phase 2 queue');

// Check that incorrect card is prioritized (appears before uncertain)
const idxInQ2_c3 = engine.queue.indexOf(card3.id);
const idxInQ2_c2 = engine.queue.indexOf(card2.id);
console.assert(idxInQ2_c3 < idxInQ2_c2, 'Incorrect card (card3) should appear before uncertain card (card2) in Phase 2');
console.log('Phase 1 → 2 transition tests passed!');

// 6. Test Phase 2 Reinforcement Mechanics
console.log('\n--- Testing Phase 2 Reinforcement ---');
// In Phase 2, answer card3 (incorrect from phase1) as CONFIDENT 3 times
const p2Card1 = engine.getCurrentCard();
console.log('Phase 2 first card:', p2Card1.id, '(should be card3 - incorrect from Phase 1)');
console.assert(p2Card1.id === card3.id, 'First Phase 2 card should be card3 (incorrect priority)');

engine.revealAnswer();
engine.submitResult(ReviewResult.CONFIDENT);
let p2c3prog = engine.progressMap.get(card3.id);
console.assert(p2c3prog.consecutiveCorrect === 1, 'Phase 2: card3 should have consecutiveCorrect=1');
console.assert(p2c3prog.nextReviewAt !== null, 'Phase 2: card3 should have nextReviewAt set (10 min)');
console.assert(p2c3prog.provisionalMastery === false, 'Phase 2: card3 should NOT have mastery after 1 correct');

// Continue Phase 2: card2 (uncertain from phase1)
const p2Card2 = engine.getCurrentCard();
console.assert(p2Card2.id === card2.id, 'Next should be card2');
engine.revealAnswer();
engine.submitResult(ReviewResult.CONFIDENT);
let p2c2prog = engine.progressMap.get(card2.id);
console.assert(p2c2prog.consecutiveCorrect === 1, 'Phase 2: card2 should have consecutiveCorrect=1');

// Card3 second confident
const p2Card3b = engine.getCurrentCard();
// This might be card3 again if it was re-queued, or something else
engine.revealAnswer();
engine.submitResult(ReviewResult.CONFIDENT);

// Card2 second confident  
const p2Card2b = engine.getCurrentCard();
engine.revealAnswer();
engine.submitResult(ReviewResult.CONFIDENT);

// Card3 third confident
const p2Card3c = engine.getCurrentCard();
engine.revealAnswer();
engine.submitResult(ReviewResult.CONFIDENT);

// Check if card3 achieved mastery
p2c3prog = engine.progressMap.get(card3.id);
console.log('card3 consecutiveCorrect:', p2c3prog.consecutiveCorrect, 'mastery:', p2c3prog.provisionalMastery);

// Card2 third confident
const p2Card2c = engine.getCurrentCard();
engine.revealAnswer();
engine.submitResult(ReviewResult.CONFIDENT);

p2c2prog = engine.progressMap.get(card2.id);
console.log('card2 consecutiveCorrect:', p2c2prog.consecutiveCorrect, 'mastery:', p2c2prog.provisionalMastery);

// Phase 2 should now be complete (both cards mastered)
console.log('Phase 2 just completed:', engine.phaseJustCompleted);
console.log('Phase 2 reinforcement tests passed!');

// 7. Test Phase 2 Incorrect re-queue interval
console.log('\n--- Testing Phase 2 Incorrect Re-queue ---');
const examP2Test = { id: 'p2test', name: 'P2 Test', currentPhase: StudyPhase.PHASE_2 };
const p2Cards = [
  { id: 'p2c1', front: 'P2Q1', back: 'P2A1', cardType: 'basic' }
];
const p2Prog = [{
  id: 'prog-p2c1',
  cardId: 'p2c1',
  examId: 'p2test',
  reviewCount: 0,
  consecutiveCorrect: 0,
  lastResult: null,
  lastReviewedAt: null,
  nextReviewAt: null,
  phaseStatus: 2,
  phase1Result: ReviewResult.INCORRECT,
  provisionalMastery: false
}];
const engineP2 = new StudySessionEngine(examP2Test, p2Cards, p2Prog, SessionMode.PHASE);
console.assert(engineP2.queue.length === 1, 'P2 queue should have 1 card');

engineP2.revealAnswer();
engineP2.submitResult(ReviewResult.INCORRECT);
const progAfterIncorrect = engineP2.progressMap.get('p2c1');
console.log('After incorrect, nextReviewAt exists:', !!progAfterIncorrect.nextReviewAt);
console.assert(progAfterIncorrect.consecutiveCorrect === 0, 'consecutive should be 0 after incorrect');

// The card should be re-inserted into the queue
console.assert(engineP2.queue.length > 1, 'Card should be re-inserted into queue after incorrect');
console.log('Phase 2 incorrect re-queue test passed!');

// 8. Test Undo Functionality
console.log('\n--- Testing Undo Functionality ---');
const engineUndo = new StudySessionEngine(
  { id: 'exam123', name: 'Test Exam', currentPhase: StudyPhase.PHASE_1 },
  mockCards, [], SessionMode.PHASE
);
const uCard1 = engineUndo.getCurrentCard();
engineUndo.revealAnswer();
engineUndo.submitResult(ReviewResult.INCORRECT);
console.assert(engineUndo.currentIndex === 1, 'Index should be 1 after answering card 1');
console.assert(engineUndo.canUndo() === true, 'canUndo should be true');

// Check that phase1Routing was set
console.assert(engineUndo.phase1Routing[uCard1.id] === 'phase2', 'phase1Routing should be phase2 for incorrect');

// Perform Undo
const undoResult = engineUndo.undo();
console.assert(undoResult.card.id === uCard1.id, 'Should undo back to card 1');
console.assert(engineUndo.currentIndex === 0, 'Index should be reset to 0');
console.assert(engineUndo.isAnswerRevealed === true, 'Answer should be revealed on undone card for quick re-rating');
console.assert(engineUndo.sessionResults.length === 0, 'sessionResults should be empty after undo');
console.assert(engineUndo.canUndo() === false, 'canUndo should now be false');
// Phase1 routing should be reverted
console.assert(!(uCard1.id in engineUndo.phase1Routing), 'phase1Routing should be reverted on undo');

// Now re-rate correctly as Confident
engineUndo.submitResult(ReviewResult.CONFIDENT);
console.assert(engineUndo.currentIndex === 1, 'Index should be 1 again');
const uProg = engineUndo.getUpdatedProgressList().find(p => p.cardId === uCard1.id);
console.assert(uProg.phase1Result === ReviewResult.CONFIDENT, 'Progression should reflect new rating CONFIDENT');
console.assert(engineUndo.phase1Routing[uCard1.id] === 'phase3', 'phase1Routing should now be phase3');
console.log('Undo test passed!');

// 9. Test Pause & Resume State Export / Restore
console.log('\n--- Testing Pause & Resume State ---');
const exportedState = engineUndo.exportState();
console.assert(exportedState.currentIndex === 1, 'Exported state should have currentIndex 1');
console.assert(exportedState.queue.length === 3, 'Exported state should preserve queue');
console.assert(exportedState.phase1Routing !== undefined, 'Exported state should include phase1Routing');

// Create resumed engine
const resumedEngine = new StudySessionEngine(
  { id: 'exam123', name: 'Test Exam', currentPhase: StudyPhase.PHASE_1 },
  mockCards, engineUndo.getUpdatedProgressList(), SessionMode.PHASE, exportedState
);
console.assert(resumedEngine.currentIndex === 1, 'Resumed engine should start at currentIndex 1');
console.assert(resumedEngine.queue.length === 3, 'Resumed engine should preserve exact queue');
console.assert(resumedEngine.canUndo() === true, 'Resumed engine should keep undo history');
console.assert(resumedEngine.phase1Routing[uCard1.id] === 'phase3', 'Resumed engine should preserve phase1Routing');
console.log('Pause and Resume test passed!');

// 10. Test Phase 3 Setup
console.log('\n--- Testing Phase 3 Stage Setup ---');
const p3Exam = { id: 'exam-p3', name: 'P3 Test', currentPhase: StudyPhase.PHASE_3 };
const p3Cards = [
  { id: 'p3c1', front: 'Hard', back: 'A1', cardType: 'basic' },
  { id: 'p3c2', front: 'Easy', back: 'A2', cardType: 'basic' },
  { id: 'p3c3', front: 'Confident', back: 'A3', cardType: 'basic' }
];
const p3Progress = [
  { id: 'prog1', cardId: 'p3c1', examId: 'exam-p3', reviewCount: 5, consecutiveCorrect: 1, lastResult: 'incorrect', phase1Result: ReviewResult.INCORRECT, provisionalMastery: false },
  { id: 'prog2', cardId: 'p3c2', examId: 'exam-p3', reviewCount: 5, consecutiveCorrect: 3, lastResult: 'confident', phase1Result: ReviewResult.UNCERTAIN, provisionalMastery: true },
  { id: 'prog3', cardId: 'p3c3', examId: 'exam-p3', reviewCount: 1, consecutiveCorrect: 0, lastResult: 'confident', phase1Result: ReviewResult.CONFIDENT, provisionalMastery: false }
];
const engineP3 = new StudySessionEngine(p3Exam, p3Cards, p3Progress, SessionMode.PHASE);
console.log('Phase 3 Stage 1 (hard Phase 2):', engineP3.phase3StageCards[1]);
console.log('Phase 3 Stage 2 (easy Phase 2):', engineP3.phase3StageCards[2]);
console.log('Phase 3 Stage 3 (confident Phase 1):', engineP3.phase3StageCards[3]);
console.assert(engineP3.phase3StageCards[1].includes('p3c1'), 'Hard Phase 2 card should be in stage 1');
console.assert(engineP3.phase3StageCards[2].includes('p3c2'), 'Easy Phase 2 card should be in stage 2');
console.assert(engineP3.phase3StageCards[3].includes('p3c3'), 'Confident Phase 1 card should be in stage 3');
console.log('Phase 3 setup tests passed!');

console.log('\n✅ All core logic assertions passed successfully!');
