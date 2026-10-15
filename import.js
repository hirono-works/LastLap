/**
 * import.js — File parsing (CSV, TSV, Anki plain text), mapping, preview, and validation
 * Implements Section 4 of PROJECT_SPEC.md
 */

const FileImporter = {
  /**
   * Robust CSV / TSV / Anki text parser supporting quotes, multiline values, and delimiters.
   */
  parseDelimitedText(content, delimiter = null) {
    if (!content || !content.trim()) {
      return { headers: [], rows: [], totalLines: 0, error: 'File is empty.' };
    }

    // Auto-detect delimiter if not specified
    if (!delimiter) {
      delimiter = this.detectDelimiter(content);
    }

    const lines = [];
    let currentField = '';
    let currentRow = [];
    let insideQuotes = false;
    let i = 0;
    const len = content.length;

    while (i < len) {
      const char = content[i];
      const nextChar = content[i + 1];

      // Handle quotes
      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i += 2;
          continue;
        } else {
          insideQuotes = !insideQuotes;
          i++;
          continue;
        }
      }

      // Handle delimiters
      if (!insideQuotes && char === delimiter) {
        currentRow.push(currentField);
        currentField = '';
        i++;
        continue;
      }

      // Handle newlines
      if (!insideQuotes && (char === '\r' || char === '\n')) {
        // Skip \r\n as a single newline
        if (char === '\r' && nextChar === '\n') {
          i++;
        }
        currentRow.push(currentField);
        currentField = '';

        // Skip Anki header comments like #separator:tab or #html:true
        const isComment = currentRow.length === 1 && currentRow[0].trim().startsWith('#');
        if (!isComment && (currentRow.length > 1 || currentRow[0].trim() !== '')) {
          lines.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      }

      currentField += char;
      i++;
    }

    // Push the final field and row
    if (currentField !== '' || currentRow.length > 0) {
      currentRow.push(currentField);
      const isComment = currentRow.length === 1 && currentRow[0].trim().startsWith('#');
      if (!isComment && (currentRow.length > 1 || currentRow[0].trim() !== '')) {
        lines.push(currentRow);
      }
    }

    if (lines.length === 0) {
      return { headers: [], rows: [], totalLines: 0, error: 'No valid data rows found.' };
    }

    // Determine if first row is a header
    // If first row contains typical header words or if rows are consistent
    const firstRow = lines[0];
    const columnCount = Math.max(...lines.map((r) => r.length));

    // Pad rows to have uniform column count
    const normalizedRows = lines.map((row) => {
      const padded = [...row];
      while (padded.length < columnCount) padded.push('');
      return padded;
    });

    // Check if first row is likely header
    const hasHeaderCandidate = firstRow.some((col) =>
      /^(front|back|question|answer|prompt|text|cloze|field|note|tag|id)$/i.test(col.trim())
    );

    let headers;
    let dataRows;

    if (hasHeaderCandidate) {
      headers = normalizedRows[0].map((h, idx) => (h.trim() ? h.trim() : `Column ${idx + 1}`));
      dataRows = normalizedRows.slice(1);
    } else {
      headers = Array.from({ length: columnCount }, (_, idx) => `Column ${idx + 1}`);
      dataRows = normalizedRows;
    }

    return {
      headers,
      rows: dataRows,
      delimiter,
      totalRows: dataRows.length
    };
  },

  /**
   * Detects whether TSV, CSV, or semicolon-delimited.
   */
  detectDelimiter(content) {
    const sample = content.slice(0, 5000);
    const tabCount = (sample.match(/\t/g) || []).length;
    const commaCount = (sample.match(/,/g) || []).length;
    const semicolonCount = (sample.match(/;/g) || []).length;

    if (tabCount > commaCount && tabCount > semicolonCount) return '\t';
    if (semicolonCount > commaCount) return ';';
    return ',';
  },

  /**
   * Generates card objects from rows and user-selected mappings.
   * mapping: {
   *   frontColIndex: number,
   *   backColIndex: number,
   *   supplementaryIndices: number[],
   *   isClozeMode: boolean
   * }
   */
  buildCardsFromParsedData({ examId, headers, rows, mapping, existingCards = [] }) {
    const cards = [];
    const errors = [];
    const warnings = [];
    const existingFrontSet = new Set(existingCards.map((c) => (c.front || '').trim().toLowerCase()));
    let duplicateCount = 0;

    rows.forEach((row, rowIndex) => {
      const rowNum = rowIndex + 1;
      const frontVal = (row[mapping.frontColIndex] || '').trim();
      const backVal = mapping.backColIndex >= 0 ? (row[mapping.backColIndex] || '').trim() : '';

      // Gather supplementary fields
      const supplementaryFields = (mapping.supplementaryIndices || []).map((idx) => ({
        label: headers[idx] || `Field ${idx + 1}`,
        value: (row[idx] || '').trim()
      })).filter((item) => item.value !== '');

      // Check cloze pattern in front or text
      const hasClozeSyntax = ClozeParser.extractIndices(frontVal).length > 0;

      if (mapping.isClozeMode || hasClozeSyntax) {
        if (!frontVal) {
          warnings.push(`Row #${rowNum} skipped: Front/Text is empty.`);
          return;
        }

        const clozeCards = CardManager.createClozeCardsFromNote({
          examId,
          text: frontVal,
          supplementaryFields
        });

        clozeCards.forEach((card) => {
          const valRes = CardManager.validateCard(card);
          if (!valRes.valid) {
            errors.push(`Row #${rowNum}: ${valRes.errors.join(', ')}`);
          } else {
            cards.push(card);
          }
        });
      } else {
        // Basic Card
        if (!frontVal && !backVal) {
          warnings.push(`Row #${rowNum} skipped: Both front and back are empty.`);
          return;
        }
        if (!frontVal) {
          errors.push(`Row #${rowNum}: Front text is missing.`);
          return;
        }
        if (!backVal) {
          warnings.push(`Row #${rowNum}: Back text is empty for front "${frontVal.slice(0, 20)}...".`);
        }

        // Duplicate check
        if (existingFrontSet.has(frontVal.toLowerCase())) {
          duplicateCount++;
        }

        const card = CardManager.createBasicCard({
          examId,
          front: frontVal,
          back: backVal,
          supplementaryFields
        });

        cards.push(card);
      }
    });

    if (duplicateCount > 0) {
      warnings.push(`${duplicateCount} card(s) have front text matching already existing cards in this exam.`);
    }

    return {
      cards,
      errors,
      warnings,
      duplicateCount
    };
  }
};
