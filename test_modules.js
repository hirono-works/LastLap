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

console.log('Session is complete:', engine.isComplete());
console.assert(engine.isComplete() === true, 'Session should be complete');

const updatedProg = engine.getUpdatedProgressList();
const c1Prog = updatedProg.find(p => p.cardId === card1.id);
const c2Prog = updatedProg.find(p => p.cardId === card2.id);
const c3Prog = updatedProg.find(p => p.cardId === card3.id);

console.log('card1 (confident) consecutive correct:', c1Prog.consecutiveCorrect);
console.assert(c1Prog.consecutiveCorrect === 1, 'card1 should have consecutiveCorrect 1');
console.log('card2 (uncertain) lastResult:', c2Prog.lastResult);
console.assert(c2Prog.lastResult === ReviewResult.UNCERTAIN, 'card2 should be uncertain');
console.log('card3 (incorrect) consecutive correct:', c3Prog.consecutiveCorrect);
console.assert(c3Prog.consecutiveCorrect === 0, 'card3 should have 0 consecutive correct');

// Phase 2 Weak Card selection test
const phase2Exam = { id: 'exam123', name: 'Test Exam', currentPhase: StudyPhase.PHASE_2 };
const enginePhase2 = new StudySessionEngine(phase2Exam, mockCards, updatedProg, SessionMode.PHASE);
console.log('Phase 2 Queue length:', enginePhase2.queue.length);
console.assert(enginePhase2.queue.length === 3, 'Phase 2 queues weak cards first');

console.log('\nAll core logic assertions passed successfully!');
