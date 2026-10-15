/**
 * cards.js — Card models, Cloze parsing, rendering, and validation for LastLap
 */

const CardType = {
  BASIC: 'basic',
  CLOZE: 'cloze'
};

/**
 * Utility to generate unique ID
 */
function generateId() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

/**
 * Cloze Parser and Utilities
 * Handles syntax: {{c1::answer}} or {{c1::answer::hint}}
 */
const ClozeParser = {
  // Regex to match {{cN::answer}} or {{cN::answer::hint}}
  CLOZE_REGEX: /\{\{c(\d+)::([^:]+?)(?:::([^:]+?))?\}\}/g,

  /**
   * Extracts all unique cloze indices (e.g. [1, 2]) found in the text.
   */
  extractIndices(text) {
    if (!text) return [];
    const indices = new Set();
    const regex = new RegExp(this.CLOZE_REGEX);
    let match;
    while ((match = regex.exec(text)) !== null) {
      indices.add(parseInt(match[1], 10));
    }
    return Array.from(indices).sort((a, b) => a - b);
  },

  /**
   * Renders cloze text for study question (prompt).
   * For the targetIndex, replaces with "[...]" or "[hint]".
   * For other indices, reveals the actual answer seamlessly.
   */
  renderQuestion(text, targetIndex) {
    if (!text) return '';
    return text.replace(new RegExp(this.CLOZE_REGEX), (match, idx, answer, hint) => {
      const currentIdx = parseInt(idx, 10);
      if (currentIdx === targetIndex) {
        if (hint && hint.trim()) {
          return `<span class="cloze-blank cloze-hint">[${this.escapeHtml(hint.trim())}]</span>`;
        }
        return `<span class="cloze-blank">[...]</span>`;
      } else {
        // Other cloze deletion: display plain answer text
        return this.escapeHtml(answer);
      }
    });
  },

  /**
   * Renders cloze text for study answer (revealed).
   * Highlights the targetIndex deletion.
   */
  renderAnswer(text, targetIndex) {
    if (!text) return '';
    return text.replace(new RegExp(this.CLOZE_REGEX), (match, idx, answer, hint) => {
      const currentIdx = parseInt(idx, 10);
      if (currentIdx === targetIndex) {
        return `<span class="cloze-revealed">${this.escapeHtml(answer)}</span>`;
      } else {
        return this.escapeHtml(answer);
      }
    });
  },

  /**
   * Extracts the target answer for targetIndex.
   */
  getTargetAnswer(text, targetIndex) {
    if (!text) return '';
    const regex = new RegExp(this.CLOZE_REGEX);
    let match;
    const answers = [];
    while ((match = regex.exec(text)) !== null) {
      if (parseInt(match[1], 10) === targetIndex) {
        answers.push(match[2]);
      }
    }
    return answers.join(', ');
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};

/**
 * Card factory and helpers
 */
const CardManager = {
  createBasicCard({ examId, front, back, supplementaryFields = [], id = null }) {
    return {
      id: id || generateId(),
      examId,
      cardType: CardType.BASIC,
      front: front ? front.trim() : '',
      back: back ? back.trim() : '',
      supplementaryFields: Array.isArray(supplementaryFields) ? supplementaryFields : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  },

  /**
   * Creates one card per cloze index from a note.
   * If no cloze markup found, creates a single cloze card or basic card.
   */
  createClozeCardsFromNote({ examId, text, supplementaryFields = [], sourceNoteId = null }) {
    const indices = ClozeParser.extractIndices(text);
    const now = new Date().toISOString();

    if (indices.length === 0) {
      // Fallback: treated as single card
      return [{
        id: generateId(),
        examId,
        cardType: CardType.CLOZE,
        front: text,
        back: '',
        clozeData: {
          rawText: text,
          targetIndex: 1
        },
        supplementaryFields: supplementaryFields || [],
        sourceNoteId: sourceNoteId || generateId(),
        createdAt: now,
        updatedAt: now
      }];
    }

    const noteId = sourceNoteId || generateId();
    return indices.map((idx) => ({
      id: generateId(),
      examId,
      cardType: CardType.CLOZE,
      front: text,
      back: ClozeParser.getTargetAnswer(text, idx),
      clozeData: {
        rawText: text,
        targetIndex: idx
      },
      supplementaryFields: supplementaryFields || [],
      sourceNoteId: noteId,
      createdAt: now,
      updatedAt: now
    }));
  },

  /**
   * Validates a card object before saving.
   * Returns { valid: boolean, errors: string[] }
   */
  validateCard(card) {
    const errors = [];
    if (!card.examId) {
      errors.push('Exam ID is required.');
    }

    if (card.cardType === CardType.CLOZE) {
      const text = card.clozeData ? card.clozeData.rawText : card.front;
      if (!text || !text.trim()) {
        errors.push('Cloze note text cannot be empty.');
      } else {
        const indices = ClozeParser.extractIndices(text);
        if (indices.length === 0) {
          errors.push('No cloze deletion syntax found (e.g. {{c1::answer}}).');
        }
      }
    } else {
      // Basic card
      if (!card.front || !card.front.trim()) {
        errors.push('Card front cannot be empty.');
      }
      if (!card.back || !card.back.trim()) {
        errors.push('Card back cannot be empty.');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  },

  /**
   * Helper to safely escape HTML string for rendering.
   */
  escape(str) {
    return ClozeParser.escapeHtml(str);
  }
};
