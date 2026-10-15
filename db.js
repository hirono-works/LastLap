/**
 * db.js — IndexedDB wrapper for LastLap
 * Handles persistent storage for exams, cards, card progress, and study sessions.
 */

const DB_NAME = 'LastLapDB';
const DB_VERSION = 1;

class Database {
  constructor() {
    this.db = null;
    this._initPromise = null;
  }

  async init() {
    if (this.db) return this.db;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Exams store
        if (!db.objectStoreNames.contains('exams')) {
          const examStore = db.createObjectStore('exams', { keyPath: 'id' });
          examStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Cards store
        if (!db.objectStoreNames.contains('cards')) {
          const cardStore = db.createObjectStore('cards', { keyPath: 'id' });
          cardStore.createIndex('examId', 'examId', { unique: false });
          cardStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Card progress store
        if (!db.objectStoreNames.contains('cardProgress')) {
          const progressStore = db.createObjectStore('cardProgress', { keyPath: 'id' });
          progressStore.createIndex('examId', 'examId', { unique: false });
          progressStore.createIndex('cardId', 'cardId', { unique: false });
          progressStore.createIndex('exam_card', ['examId', 'cardId'], { unique: true });
        }

        // Study sessions store
        if (!db.objectStoreNames.contains('studySessions')) {
          const sessionStore = db.createObjectStore('studySessions', { keyPath: 'id' });
          sessionStore.createIndex('examId', 'examId', { unique: false });
          sessionStore.createIndex('startedAt', 'startedAt', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });

    return this._initPromise;
  }

  // Generic transaction helper
  async _tx(storeName, mode, callback) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);

      let result;
      try {
        result = callback(store);
      } catch (err) {
        reject(err);
        return;
      }

      transaction.oncomplete = () => resolve(result);
      transaction.onerror = (e) => reject(e.target.error || transaction.error);
      transaction.onabort = (e) => reject(new Error('Transaction aborted'));
    });
  }

  // --- Exams ---
  async getAllExams() {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('exams', 'readonly');
      const store = tx.objectStore('exams');
      const req = store.getAll();
      req.onsuccess = () => {
        const exams = req.result || [];
        exams.sort((a, b) => new Date(a.examDate) - new Date(b.examDate));
        resolve(exams);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getExam(id) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('exams', 'readonly');
      const store = tx.objectStore('exams');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveExam(exam) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('exams', 'readwrite');
      const store = tx.objectStore('exams');
      exam.updatedAt = new Date().toISOString();
      if (!exam.createdAt) exam.createdAt = exam.updatedAt;
      const req = store.put(exam);
      req.onsuccess = () => resolve(exam);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteExam(id) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['exams', 'cards', 'cardProgress', 'studySessions'], 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);

      // Delete exam
      tx.objectStore('exams').delete(id);

      // Delete cards belonging to exam
      const cardStore = tx.objectStore('cards');
      const cardIndex = cardStore.index('examId');
      const cardReq = cardIndex.openKeyCursor(IDBKeyRange.only(id));
      cardReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cardStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      // Delete cardProgress belonging to exam
      const progStore = tx.objectStore('cardProgress');
      const progIndex = progStore.index('examId');
      const progReq = progIndex.openKeyCursor(IDBKeyRange.only(id));
      progReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          progStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };

      // Delete studySessions belonging to exam
      const sessStore = tx.objectStore('studySessions');
      const sessIndex = sessStore.index('examId');
      const sessReq = sessIndex.openKeyCursor(IDBKeyRange.only(id));
      sessReq.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          sessStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
    });
  }

  // --- Cards ---
  async getCardsByExam(examId) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('cards', 'readonly');
      const store = tx.objectStore('cards');
      const index = store.index('examId');
      const req = index.getAll(IDBKeyRange.only(examId));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getCard(id) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('cards', 'readonly');
      const store = tx.objectStore('cards');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveCard(card) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('cards', 'readwrite');
      const store = tx.objectStore('cards');
      card.updatedAt = new Date().toISOString();
      if (!card.createdAt) card.createdAt = card.updatedAt;
      const req = store.put(card);
      req.onsuccess = () => resolve(card);
      req.onerror = () => reject(req.error);
    });
  }

  async saveCardsBulk(cards) {
    if (!cards || cards.length === 0) return [];
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cards', 'readwrite');
      const store = tx.objectStore('cards');
      const now = new Date().toISOString();
      for (const card of cards) {
        if (!card.createdAt) card.createdAt = now;
        card.updatedAt = now;
        store.put(card);
      }
      tx.oncomplete = () => resolve(cards);
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteCard(id) {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['cards', 'cardProgress'], 'readwrite');
      tx.objectStore('cards').delete(id);

      const progStore = tx.objectStore('cardProgress');
      const progIndex = progStore.index('cardId');
      const req = progIndex.openKeyCursor(IDBKeyRange.only(id));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          progStore.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Card Progress ---
  async getProgressByExam(examId) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('cardProgress', 'readonly');
      const store = tx.objectStore('cardProgress');
      const index = store.index('examId');
      const req = index.getAll(IDBKeyRange.only(examId));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async getCardProgress(examId, cardId) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('cardProgress', 'readonly');
      const store = tx.objectStore('cardProgress');
      const index = store.index('exam_card');
      const req = index.get([examId, cardId]);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveCardProgress(progress) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('cardProgress', 'readwrite');
      const store = tx.objectStore('cardProgress');
      progress.updatedAt = new Date().toISOString();
      const req = store.put(progress);
      req.onsuccess = () => resolve(progress);
      req.onerror = () => reject(req.error);
    });
  }

  async saveCardProgressBulk(progressList) {
    if (!progressList || progressList.length === 0) return [];
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cardProgress', 'readwrite');
      const store = tx.objectStore('cardProgress');
      const now = new Date().toISOString();
      for (const p of progressList) {
        p.updatedAt = now;
        store.put(p);
      }
      tx.oncomplete = () => resolve(progressList);
      tx.onerror = () => reject(tx.error);
    });
  }

  // --- Study Sessions ---
  async getSessionsByExam(examId) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('studySessions', 'readonly');
      const store = tx.objectStore('studySessions');
      const index = store.index('examId');
      const req = index.getAll(IDBKeyRange.only(examId));
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async saveStudySession(session) {
    return new Promise(async (resolve, reject) => {
      const db = await this.init();
      const tx = db.transaction('studySessions', 'readwrite');
      const store = tx.objectStore('studySessions');
      const req = store.put(session);
      req.onsuccess = () => resolve(session);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Entire DB Export / Import for Backup ---
  async exportAllData() {
    const db = await this.init();
    const stores = ['exams', 'cards', 'cardProgress', 'studySessions'];
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {}
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readonly');
      let completed = 0;

      stores.forEach((storeName) => {
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => {
          exportData.data[storeName] = req.result || [];
          completed++;
          if (completed === stores.length) {
            resolve(exportData);
          }
        };
      });

      tx.onerror = () => reject(tx.error);
    });
  }

  async restoreAllData(backupData, replaceExisting = true) {
    const db = await this.init();
    const stores = ['exams', 'cards', 'cardProgress', 'studySessions'];

    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);

      stores.forEach((storeName) => {
        const store = tx.objectStore(storeName);
        if (replaceExisting) {
          store.clear();
        }
        const items = backupData.data[storeName] || [];
        items.forEach((item) => {
          store.put(item);
        });
      });
    });
  }
}

// Export singleton instance
const db = new Database();
