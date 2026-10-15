/**
 * backup.js — Full data export and validated restore for LastLap
 * Implements Section 10 of PROJECT_SPEC.md
 */

const BackupManager = {
  /**
   * Generates a backup JSON and triggers file download.
   */
  async exportBackup() {
    try {
      const data = await db.exportAllData();
      data.app = 'LastLap';
      data.schemaVersion = 1;
      data.exportedAt = new Date().toISOString();

      // Include settings from localStorage if any
      const settings = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('lastlap_')) {
          settings[key] = localStorage.getItem(key);
        }
      }
      data.settings = settings;

      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lastlap-backup-${timestamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      return { success: true };
    } catch (err) {
      console.error('Export failed:', err);
      throw new Error(`Export failed: ${err.message}`);
    }
  },

  /**
   * Validates a parsed backup data structure before restoring.
   */
  validateBackup(backupData) {
    const errors = [];

    if (!backupData || typeof backupData !== 'object') {
      return { valid: false, errors: ['Backup file is not a valid JSON object.'] };
    }

    if (!backupData.data || typeof backupData.data !== 'object') {
      errors.push('Missing "data" container in backup file.');
    } else {
      const { exams, cards, cardProgress, studySessions } = backupData.data;

      if (!Array.isArray(exams)) {
        errors.push('"exams" must be an array.');
      } else {
        // Validate each exam
        exams.forEach((ex, idx) => {
          if (!ex.id || !ex.name || !ex.examDate) {
            errors.push(`Exam at index ${idx} is missing required fields (id, name, examDate).`);
          }
        });
      }

      if (!Array.isArray(cards)) {
        errors.push('"cards" must be an array.');
      } else {
        // Validate card essentials
        cards.forEach((cd, idx) => {
          if (!cd.id || !cd.examId) {
            errors.push(`Card at index ${idx} is missing required fields (id, examId).`);
          }
        });
      }

      if (!Array.isArray(cardProgress)) {
        errors.push('"cardProgress" must be an array.');
      }

      if (!Array.isArray(studySessions)) {
        errors.push('"studySessions" must be an array.');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      counts: backupData.data ? {
        exams: (backupData.data.exams || []).length,
        cards: (backupData.data.cards || []).length,
        progress: (backupData.data.cardProgress || []).length,
        sessions: (backupData.data.studySessions || []).length
      } : null
    };
  },

  /**
   * Restores data with safety validation and mode choice (replace vs merge).
   */
  async restoreBackup(backupData, replaceExisting = true) {
    const val = this.validateBackup(backupData);
    if (!val.valid) {
      throw new Error(`Invalid backup data: ${val.errors.join('; ')}`);
    }

    try {
      await db.restoreAllData(backupData, replaceExisting);

      // Restore settings if present
      if (backupData.settings && typeof backupData.settings === 'object') {
        Object.entries(backupData.settings).forEach(([k, v]) => {
          localStorage.setItem(k, v);
        });
      }

      return {
        success: true,
        counts: val.counts
      };
    } catch (err) {
      console.error('Restore failed:', err);
      throw new Error(`Database restoration failed: ${err.message}`);
    }
  }
};
