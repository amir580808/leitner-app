(() => {
  'use strict';

  const STORAGE_KEYS = {
    CARDS: 'leitner_cards_v1',
    CATEGORIES: 'leitner_categories_v1',
    INITIALIZED: 'leitner_initialized_v1',
    A1_LOADED: 'leitner_a1_loaded_v1',
    THEME: 'leitner_theme_v1',
    ACCENT: 'leitner_accent_v1'
  };

  const DAY_MS = 24 * 60 * 60 * 1000;

  // 7-Level Leitner Intervals (in days)
  const LEVEL_INTERVALS = {
    1: 1,
    2: 2,
    3: 4,
    4: 8,
    5: 15,
    6: 30,
    7: 60
  };

  const LEVEL_LABELS = {
    1: 'هر ۱ روز',
    2: 'هر ۲ روز',
    3: 'هر ۴ روز',
    4: 'هر ۸ روز',
    5: 'هر ۱۵ روز',
    6: 'هر ۳۰ روز',
    7: 'تسلط (۶۰ روز)'
  };

  const DEFAULT_CATEGORIES = ['Oxford A1', 'Oxford Word Skills', 'لغات مهم'];

  const SAMPLE_OXFORD_WORDS = [
    {
      word: 'resilient',
      meaning: 'تاب‌آور، انعطاف‌پذیر در برابر سختی‌ها',
      example: 'She is remarkably resilient and recovers quickly from setbacks.',
      category: 'Oxford Word Skills'
    },
    {
      word: 'procrastinate',
      meaning: 'به تعویق انداختن، امروز و فردا کردن',
      example: 'Stop procrastinating and start studying for your exam today.',
      category: 'Oxford Word Skills'
    },
    {
      word: 'ubiquitous',
      meaning: 'همه‌جا حاضر، بسیار رایج',
      example: 'Smartphones have become ubiquitous in modern daily life.',
      category: 'Oxford Word Skills'
    },
    {
      word: 'meticulous',
      meaning: 'بسیار دقیق و موشکافانه',
      example: 'He kept meticulous notes during every lecture.',
      category: 'Oxford Word Skills'
    },
    {
      word: 'ambiguous',
      meaning: 'مبهم، دوپهلو',
      example: 'The instructions were ambiguous, so nobody knew what to do.',
      category: 'Oxford Word Skills'
    }
  ];

  // App State
  let cards = [];
  let categories = [];
  let currentAccent = 'en-US';
  let currentView = 'dashboard';
  let reviewQueue = [];
  let reviewIndex = 0;
  let reviewTotal = 0;
  let unknownInSession = 0;
  let toastTimer = null;

  // DOM Elements
  const $ = (id) => document.getElementById(id);
  const views = document.querySelectorAll('.view');
  const navItems = document.querySelectorAll('.nav-item');

  // Utilities
  function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'card_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function toPersianDigits(num) {
    const digits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(num).replace(/\d/g, (d) => digits[Number(d)]);
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2600);
  }

  // Storage Layer
  function loadState() {
    const initialized = localStorage.getItem(STORAGE_KEYS.INITIALIZED);

    try {
      const savedCats = JSON.parse(localStorage.getItem(STORAGE_KEYS.CATEGORIES) || 'null');
      categories = Array.isArray(savedCats) && savedCats.length ? savedCats : [...DEFAULT_CATEGORIES];
    } catch {
      categories = [...DEFAULT_CATEGORIES];
    }

    try {
      const savedCards = JSON.parse(localStorage.getItem(STORAGE_KEYS.CARDS) || 'null');
      cards = Array.isArray(savedCards) ? savedCards : [];
    } catch {
      cards = [];
    }

    if (!initialized) {
      const now = Date.now();
      cards = SAMPLE_OXFORD_WORDS.map((item, idx) => ({
        id: generateId(),
        word: item.word,
        meaning: item.meaning,
        example: item.example,
        category: item.category,
        level: 1,
        nextReview: now - (SAMPLE_OXFORD_WORDS.length - idx) * 1000,
        createdAt: now
      }));
      localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
      saveState();
    }

    // Theme
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(savedTheme || (prefersDark ? 'dark' : 'light'));

    // Accent
    const savedAccent = localStorage.getItem(STORAGE_KEYS.ACCENT);
    applyAccent(savedAccent === 'en-GB' ? 'en-GB' : 'en-US');
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEYS.CARDS, JSON.stringify(cards));
    localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  }

  function applyAccent(accent) {
    currentAccent = accent;
    localStorage.setItem(STORAGE_KEYS.ACCENT, accent);
    const shortLabel = accent === 'en-GB' ? 'UK' : 'US';
    $('accentLabel').textContent = shortLabel;
    $('speakAccentTag').textContent = shortLabel;
    $('segUsBtn').classList.toggle('active', accent === 'en-US');
    $('segUkBtn').classList.toggle('active', accent === 'en-GB');
  }

  // Leitner Logic
  function getDueCards(now = Date.now()) {
    return cards
      .filter((c) => Number(c.nextReview) <= now)
      .sort((a, b) => a.nextReview - b.nextReview);
  }

  function markCardKnown(cardId) {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    const nextLevel = Math.min(7, Number(card.level) + 1);
    const intervalDays = LEVEL_INTERVALS[nextLevel] || 60;
    card.level = nextLevel;
    card.nextReview = Date.now() + intervalDays * DAY_MS;
    card.lastReviewedAt = Date.now();
    saveState();
  }

  function markCardUnknown(cardId) {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    card.level = 1;
    card.nextReview = Date.now();
    card.lastReviewedAt = Date.now();
    saveState();
  }

  function formatNextReview(timestamp) {
    const diff = timestamp - Date.now();
    if (diff <= 0) return { text: 'آماده مرور', isDue: true };
    const hours = Math.ceil(diff / (60 * 60 * 1000));
    if (hours < 24) return { text: `${toPersianDigits(hours)} ساعت دیگر`, isDue: false };
    const days = Math.ceil(diff / DAY_MS);
    if (days === 1) return { text: 'فردا', isDue: false };
    return { text: `${toPersianDigits(days)} روز دیگر`, isDue: false };
  }

  // Web Speech API
  function speakText(text) {
    if (!text) return;
    if (!('speechSynthesis' in window)) {
      showToast('مرورگر شما از پخش تلفظ پشتیبانی نمی‌کند.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = currentAccent;
    utterance.rate = 0.95;

    const voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      const exactVoice = voices.find((v) => v.lang.toLowerCase() === currentAccent.toLowerCase());
      const fallbackEn = voices.find((v) => v.lang.toLowerCase().startsWith('en'));
      if (exactVoice) utterance.voice = exactVoice;
      else if (fallbackEn) utterance.voice = fallbackEn;
    }

    window.speechSynthesis.speak(utterance);
  }

  // Navigation
  function switchView(viewName) {
    currentView = viewName;
    views.forEach((v) => v.classList.toggle('active', v.id === `view-${viewName}`));
    navItems.forEach((btn) => btn.classList.toggle('active', btn.dataset.view === viewName));

    if (viewName === 'dashboard') {
      renderDashboard();
    } else if (viewName === 'review') {
      startReviewSession();
    } else if (viewName === 'manage') {
      renderManageView();
    }
  }

  // Dashboard Rendering
  function renderDashboard() {
    const dueCards = getDueCards();
    const dueCount = dueCards.length;
    const totalCount = cards.length;
    const masteredCount = cards.filter((c) => Number(c.level) === 7).length;

    $('dueCountDisplay').textContent = toPersianDigits(dueCount);
    $('totalWordsDisplay').textContent = toPersianDigits(totalCount);
    $('masteredWordsDisplay').textContent = toPersianDigits(masteredCount);
    $('totalCategoriesDisplay').textContent = toPersianDigits(categories.length);

    const badge = $('navDueBadge');
    badge.textContent = dueCount > 99 ? '99+' : String(dueCount);
    badge.classList.toggle('hidden', dueCount === 0);

    const startBtn = $('startReviewBtn');
    if (dueCount > 0) {
      startBtn.disabled = false;
      $('heroDesc').textContent = `${toPersianDigits(dueCount)} کارت منتظر مرور شماست. همین حالا شروع کنید!`;
    } else {
      startBtn.disabled = totalCount === 0;
      $('heroDesc').textContent = totalCount === 0
        ? 'هنوز لغتی اضافه نکرده‌اید. از بخش لغات اولین کارت را بسازید.'
        : 'آفرین! تمام کارت‌های امروز مرور شده‌اند.';
    }

    // 7-Level Chart
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    cards.forEach((c) => {
      const lvl = Math.min(7, Math.max(1, Number(c.level) || 1));
      counts[lvl] += 1;
    });
    const maxCount = Math.max(1, ...Object.values(counts));

    const chartEl = $('levelsChart');
    chartEl.innerHTML = [1, 2, 3, 4, 5, 6, 7].map((lvl) => {
      const count = counts[lvl];
      const pct = count === 0 ? 0 : Math.max(6, Math.round((count / maxCount) * 100));
      return `
        <div class="level-row" data-level="${lvl}">
          <div class="level-name">
            <strong>سطح ${toPersianDigits(lvl)}</strong>
            <span>${LEVEL_LABELS[lvl]}</span>
          </div>
          <div class="level-bar-track">
            <div class="level-bar-fill" style="width: ${pct}%"></div>
          </div>
          <div class="level-count">${toPersianDigits(count)} لغت</div>
        </div>
      `;
    }).join('');
  }

  // Review Session
  function startReviewSession() {
    reviewQueue = getDueCards();
    reviewIndex = 0;
    reviewTotal = reviewQueue.length;
    unknownInSession = 0;
    renderCurrentFlashcard();
  }

  function renderCurrentFlashcard() {
    const activeContainer = $('reviewActiveContainer');
    const emptyContainer = $('reviewEmptyContainer');

    if (reviewIndex >= reviewQueue.length) {
      activeContainer.classList.add('hidden');
      emptyContainer.classList.remove('hidden');

      const dueRemaining = getDueCards().length;
      const reviewAgainBtn = $('reviewAgainBtn');
      if (dueRemaining > 0 && unknownInSession > 0) {
        $('reviewEmptyIcon').textContent = '🔁';
        $('reviewEmptyTitle').textContent = 'پایان دور فعلی';
        $('reviewEmptyDesc').textContent = `${toPersianDigits(dueRemaining)} کارت به سطح ۱ برگشتند و برای مرور امروز آماده هستند.`;
        reviewAgainBtn.classList.remove('hidden');
      } else {
        $('reviewEmptyIcon').textContent = '🎉';
        $('reviewEmptyTitle').textContent = 'مرور امروز کامل شد!';
        $('reviewEmptyDesc').textContent = 'هیچ کارتی برای مرور باقی نمانده است. عالی پیش می‌روید!';
        reviewAgainBtn.classList.add('hidden');
      }
      renderDashboard();
      return;
    }

    activeContainer.classList.remove('hidden');
    emptyContainer.classList.add('hidden');

    const card = reviewQueue[reviewIndex];
    const flashcardEl = $('flashcard');
    flashcardEl.classList.remove('is-flipped');

    $('reviewProgressText').textContent = `${toPersianDigits(reviewIndex + 1)} از ${toPersianDigits(reviewTotal)}`;
    $('reviewProgressBar').style.width = `${Math.round(((reviewIndex) / Math.max(1, reviewTotal)) * 100)}%`;
    $('reviewCategoryPill').textContent = card.category || 'عمومی';

    const lvl = Number(card.level) || 1;
    $('cardLevelFront').textContent = `سطح ${toPersianDigits(lvl)}`;
    $('cardLevelBack').textContent = `سطح ${toPersianDigits(lvl)} • ${LEVEL_LABELS[lvl]}`;

    $('cardWordDisplay').textContent = card.word;
    $('cardWordBack').textContent = card.word;
    $('cardMeaningDisplay').textContent = card.meaning;

    const exampleBox = $('cardExampleBox');
    if (card.example && card.example.trim()) {
      $('cardExampleDisplay').textContent = card.example;
      exampleBox.classList.remove('hidden');
    } else {
      exampleBox.classList.add('hidden');
    }

    const nextLvl = Math.min(7, lvl + 1);
    $('knowNextLevelHint').textContent = lvl === 7
      ? 'تمدید تسلط (۶۰ روز)'
      : `ارتقا به سطح ${toPersianDigits(nextLvl)}`;
  }

  function handleAnswer(known) {
    const card = reviewQueue[reviewIndex];
    if (!card) return;
    if (known) {
      markCardKnown(card.id);
    } else {
      markCardUnknown(card.id);
      unknownInSession += 1;
    }
    reviewIndex += 1;
    renderCurrentFlashcard();
  }

  // Manage View
  function populateCategorySelects() {
    const filterSelect = $('filterCategorySelect');
    const currentFilter = filterSelect.value || 'all';
    filterSelect.innerHTML = '<option value="all">همه دسته‌ها</option>' +
      categories.map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
    if (categories.includes(currentFilter)) {
      filterSelect.value = currentFilter;
    }

    const inputSelect = $('inputCategory');
    const currentInput = inputSelect.value;
    inputSelect.innerHTML = categories.map((cat) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
    if (categories.includes(currentInput)) {
      inputSelect.value = currentInput;
    }
  }

  function renderManageView() {
    populateCategorySelects();

    const query = $('searchInput').value.trim().toLowerCase();
    const levelFilter = $('filterLevelSelect').value;
    const categoryFilter = $('filterCategorySelect').value;
    const now = Date.now();

    const filtered = cards.filter((c) => {
      if (levelFilter === 'due' && Number(c.nextReview) > now) return false;
      if (levelFilter !== 'all' && levelFilter !== 'due' && String(c.level) !== levelFilter) return false;
      if (categoryFilter !== 'all' && c.category !== categoryFilter) return false;
      if (query) {
        const hay = `${c.word} ${c.meaning} ${c.example || ''} ${c.category || ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    $('wordsCountLabel').textContent = `${toPersianDigits(filtered.length)} لغت`;

    const listEl = $('wordsList');
    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📚</div>
          <h2>لغتی یافت نشد</h2>
          <p>فیلترها را تغییر دهید یا یک لغت جدید اضافه کنید.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map((card) => {
      const reviewInfo = formatNextReview(card.nextReview);
      const isMastered = Number(card.level) === 7;
      return `
        <article class="word-item" data-id="${escapeHtml(card.id)}">
          <div class="word-item-top">
            <div>
              <h3 class="word-item-title en-text">${escapeHtml(card.word)}</h3>
              <p class="word-item-meaning">${escapeHtml(card.meaning)}</p>
            </div>
            <div class="word-item-actions">
              <button type="button" class="mini-btn speak-item-btn" data-id="${escapeHtml(card.id)}" title="تلفظ" aria-label="تلفظ">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
              </button>
              <button type="button" class="mini-btn edit-item-btn" data-id="${escapeHtml(card.id)}" title="ویرایش" aria-label="ویرایش">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
              </button>
              <button type="button" class="mini-btn delete delete-item-btn" data-id="${escapeHtml(card.id)}" title="حذف" aria-label="حذف">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
              </button>
            </div>
          </div>
          ${card.example ? `<p class="word-item-example en-text">${escapeHtml(card.example)}</p>` : ''}
          <div class="word-item-meta">
            <span class="meta-tag ${isMastered ? 'mastered' : ''}">سطح ${toPersianDigits(card.level)}</span>
            <span class="meta-tag">${escapeHtml(card.category || 'عمومی')}</span>
            <span class="meta-tag ${reviewInfo.isDue ? 'due' : ''}">${reviewInfo.text}</span>
          </div>
        </article>
      `;
    }).join('');
  }

  // Add / Edit Modal
  function openWordModal(cardId = null) {
    populateCategorySelects();
    $('newCategoryRow').classList.add('hidden');
    $('newCategoryInput').value = '';

    if (cardId) {
      const card = cards.find((c) => c.id === cardId);
      if (!card) return;
      $('modalTitle').textContent = 'ویرایش لغت';
      $('editCardId').value = card.id;
      $('inputWord').value = card.word;
      $('inputMeaning').value = card.meaning;
      $('inputExample').value = card.example || '';
      if (card.category && !categories.includes(card.category)) {
        categories.push(card.category);
        populateCategorySelects();
      }
      $('inputCategory').value = card.category || categories[0];
      $('inputLevel').value = String(card.level || 1);
      $('editLevelGroup').classList.remove('hidden');
    } else {
      $('modalTitle').textContent = 'افزودن لغت جدید';
      $('editCardId').value = '';
      $('wordForm').reset();
      $('inputCategory').value = categories[0];
      $('editLevelGroup').classList.add('hidden');
    }

    $('wordModal').classList.remove('hidden');
    setTimeout(() => $('inputWord').focus(), 80);
  }

  function closeWordModal() {
    $('wordModal').classList.add('hidden');
  }

  function handleWordFormSubmit(e) {
    e.preventDefault();
    const id = $('editCardId').value.trim();
    const word = $('inputWord').value.trim();
    const meaning = $('inputMeaning').value.trim();
    const example = $('inputExample').value.trim();
    const category = $('inputCategory').value || categories[0];

    if (!word || !meaning) {
      showToast('لطفاً کلمه انگلیسی و معنی فارسی را وارد کنید.');
      return;
    }

    if (id) {
      const card = cards.find((c) => c.id === id);
      if (card) {
        const newLevel = Number($('inputLevel').value) || 1;
        const levelChanged = newLevel !== card.level;
        card.word = word;
        card.meaning = meaning;
        card.example = example;
        card.category = category;
        card.level = newLevel;
        if (levelChanged) {
          card.nextReview = newLevel === 1 ? Date.now() : Date.now() + LEVEL_INTERVALS[newLevel] * DAY_MS;
        }
        showToast('لغت با موفقیت ویرایش شد.');
      }
    } else {
      const now = Date.now();
      cards.unshift({
        id: generateId(),
        word,
        meaning,
        example,
        category,
        level: 1,
        nextReview: now,
        createdAt: now
      });
      showToast('لغت جدید به سطح ۱ اضافه شد.');
    }

    saveState();
    closeWordModal();
    renderDashboard();
    if (currentView === 'manage') renderManageView();
  }

  // Export & Import
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportJSON() {
    const payload = {
      app: 'LeitnerApp7',
      version: 1,
      exportedAt: new Date().toISOString(),
      categories,
      cards
    };
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(JSON.stringify(payload, null, 2), `leitner-backup-${dateStr}.json`, 'application/json;charset=utf-8');
    showToast('فایل پشتیبان JSON دانلود شد.');
  }

  function escapeCsvCell(value) {
    const str = String(value ?? '');
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  function exportCSV() {
    const header = ['word', 'meaning', 'example', 'category', 'level', 'nextReview'];
    const rows = cards.map((c) =>
      [c.word, c.meaning, c.example || '', c.category || '', c.level || 1, new Date(c.nextReview).toISOString()]
        .map(escapeCsvCell)
        .join(',')
    );
    const csvContent = '\uFEFF' + [header.join(','), ...rows].join('\r\n');
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(csvContent, `leitner-words-${dateStr}.csv`, 'text/csv;charset=utf-8');
    showToast('فایل CSV با موفقیت دانلود شد.');
  }

  function parseCSV(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;
    const cleanText = text.replace(/^\uFEFF/, '');

    for (let i = 0; i < cleanText.length; i++) {
      const ch = cleanText[i];
      const next = cleanText[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') {
          currentCell += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          currentCell += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          currentRow.push(currentCell.trim());
          currentCell = '';
        } else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && next === '\n') i += 1;
          currentRow.push(currentCell.trim());
          if (currentRow.some((cell) => cell !== '')) rows.push(currentRow);
          currentRow = [];
          currentCell = '';
        } else {
          currentCell += ch;
        }
      }
    }
    currentRow.push(currentCell.trim());
    if (currentRow.some((cell) => cell !== '')) rows.push(currentRow);
    return rows;
  }

  function importItems(rawItems) {
    const existingWords = new Set(cards.map((c) => c.word.trim().toLowerCase()));
    const now = Date.now();
    let added = 0;
    let skipped = 0;

    rawItems.forEach((item) => {
      const word = String(item.word || '').trim();
      const meaning = String(item.meaning || '').trim();
      if (!word || !meaning) return;

      if (existingWords.has(word.toLowerCase())) {
        skipped += 1;
        return;
      }

      const category = String(item.category || 'Oxford Word Skills').trim() || 'Oxford Word Skills';
      if (!categories.includes(category)) {
        categories.push(category);
      }

      const level = Math.min(7, Math.max(1, Number(item.level) || 1));
      let nextReview = now;
      if (item.nextReview) {
        const parsedTime = typeof item.nextReview === 'number'
          ? item.nextReview
          : Date.parse(item.nextReview);
        if (!Number.isNaN(parsedTime)) nextReview = parsedTime;
      }

      cards.push({
        id: item.id || generateId(),
        word,
        meaning,
        example: String(item.example || '').trim(),
        category,
        level,
        nextReview,
        createdAt: item.createdAt || now
      });
      existingWords.add(word.toLowerCase());
      added += 1;
    });

    saveState();
    renderDashboard();
    if (currentView === 'manage') renderManageView();
    showToast(`${toPersianDigits(added)} لغت وارد شد${skipped ? ` (${toPersianDigits(skipped)} تکراری رد شد)` : ''}.`);
  }

  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const content = String(reader.result || '');
        if (file.name.toLowerCase().endsWith('.json')) {
          const parsed = JSON.parse(content);
          const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.cards) ? parsed.cards : []);
          if (!items.length) throw new Error('Empty JSON');
          importItems(items);
        } else {
          const rows = parseCSV(content);
          if (!rows.length) throw new Error('Empty CSV');
          const firstRowLower = rows[0].map((c) => c.toLowerCase());
          const hasHeader = firstRowLower.includes('word') || firstRowLower.includes('meaning');
          const startIdx = hasHeader ? 1 : 0;
          const idxWord = hasHeader && firstRowLower.indexOf('word') !== -1 ? firstRowLower.indexOf('word') : 0;
          const idxMeaning = hasHeader && firstRowLower.indexOf('meaning') !== -1 ? firstRowLower.indexOf('meaning') : 1;
          const idxExample = hasHeader && firstRowLower.indexOf('example') !== -1 ? firstRowLower.indexOf('example') : 2;
          const idxCategory = hasHeader && firstRowLower.indexOf('category') !== -1 ? firstRowLower.indexOf('category') : 3;
          const idxLevel = hasHeader && firstRowLower.indexOf('level') !== -1 ? firstRowLower.indexOf('level') : 4;
          const idxNext = hasHeader && firstRowLower.indexOf('nextreview') !== -1 ? firstRowLower.indexOf('nextreview') : 5;

          const items = rows.slice(startIdx).map((r) => ({
            word: r[idxWord] || '',
            meaning: r[idxMeaning] || '',
            example: r[idxExample] || '',
            category: r[idxCategory] || 'Oxford Word Skills',
            level: r[idxLevel] || 1,
            nextReview: r[idxNext] || ''
          }));
          importItems(items);
        }
      } catch {
        showToast('فرمت فایل نامعتبر است.');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  // Event Listeners
  function bindEvents() {
    navItems.forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    $('themeToggleBtn').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });

    $('accentToggleBtn').addEventListener('click', () => {
      applyAccent(currentAccent === 'en-US' ? 'en-GB' : 'en-US');
      showToast(currentAccent === 'en-US' ? 'لهجه آمریکایی (US) فعال شد' : 'لهجه بریتانیایی (UK) فعال شد');
    });

    $('segUsBtn').addEventListener('click', () => applyAccent('en-US'));
    $('segUkBtn').addEventListener('click', () => applyAccent('en-GB'));

    $('startReviewBtn').addEventListener('click', () => switchView('review'));
    $('goToDashboardBtn').addEventListener('click', () => switchView('dashboard'));
    $('reviewAgainBtn').addEventListener('click', () => startReviewSession());

    // 3D Card Flip
    const flashcard = $('flashcard');
    flashcard.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      flashcard.classList.toggle('is-flipped');
    });

    flashcard.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        flashcard.classList.toggle('is-flipped');
      }
    });

    $('speakWordBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const card = reviewQueue[reviewIndex];
      if (card) speakText(card.word);
    });

    $('speakWordBackBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const card = reviewQueue[reviewIndex];
      if (card) speakText(card.word);
    });

    $('speakExampleBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const card = reviewQueue[reviewIndex];
      if (card && card.example) speakText(card.example);
    });

    $('knowBtn').addEventListener('click', () => handleAnswer(true));
    $('dontKnowBtn').addEventListener('click', () => handleAnswer(false));

    // Manage View
    $('openAddModalBtn').addEventListener('click', () => openWordModal(null));
    $('closeModalBtn').addEventListener('click', closeWordModal);
    $('cancelModalBtn').addEventListener('click', closeWordModal);
    $('wordModal').addEventListener('click', (e) => {
      if (e.target === $('wordModal')) closeWordModal();
    });

    $('toggleNewCategoryBtn').addEventListener('click', () => {
      $('newCategoryRow').classList.toggle('hidden');
      if (!$('newCategoryRow').classList.contains('hidden')) {
        $('newCategoryInput').focus();
      }
    });

    $('saveNewCategoryBtn').addEventListener('click', () => {
      const val = $('newCategoryInput').value.trim();
      if (!val) return;
      if (!categories.includes(val)) {
        categories.push(val);
        saveState();
      }
      populateCategorySelects();
      $('inputCategory').value = val;
      $('newCategoryInput').value = '';
      $('newCategoryRow').classList.add('hidden');
      showToast(`دسته «${val}» اضافه شد.`);
    });

    $('wordForm').addEventListener('submit', handleWordFormSubmit);

    $('searchInput').addEventListener('input', renderManageView);
    $('filterLevelSelect').addEventListener('change', renderManageView);
    $('filterCategorySelect').addEventListener('change', renderManageView);

    $('wordsList').addEventListener('click', (e) => {
      const speakBtn = e.target.closest('.speak-item-btn');
      const editBtn = e.target.closest('.edit-item-btn');
      const deleteBtn = e.target.closest('.delete-item-btn');

      if (speakBtn) {
        const card = cards.find((c) => c.id === speakBtn.dataset.id);
        if (card) speakText(card.word);
      } else if (editBtn) {
        openWordModal(editBtn.dataset.id);
      } else if (deleteBtn) {
        const card = cards.find((c) => c.id === deleteBtn.dataset.id);
        if (card && confirm(`آیا از حذف «${card.word}» مطمئن هستید؟`)) {
          cards = cards.filter((c) => c.id !== card.id);
          saveState();
          renderManageView();
          renderDashboard();
          showToast('کارت حذف شد.');
        }
      }
    });

    // Backup & Settings
    $('exportJsonBtn').addEventListener('click', exportJSON);
    $('exportCsvBtn').addEventListener('click', exportCSV);
    $('importFileInput').addEventListener('change', handleImportFile);

    $('loadOxfordA1Btn').addEventListener('click', () => {
      loadOxfordA1Pack(false);
    });

    $('restoreSamplesBtn').addEventListener('click', () => {
      importItems(SAMPLE_OXFORD_WORDS);
    });

    $('clearAllBtn').addEventListener('click', () => {
      if (confirm('آیا مطمئن هستید؟ تمام لغات و پیشرفت شما پاک خواهد شد.')) {
        cards = [];
        saveState();
        renderDashboard();
        if (currentView === 'manage') renderManageView();
        showToast('تمام داده‌ها پاک شد.');
      }
    });

    // Keyboard shortcuts on desktop during review
    document.addEventListener('keydown', (e) => {
      if (currentView !== 'review' || !$('wordModal').classList.contains('hidden')) return;
      if (reviewIndex >= reviewQueue.length) return;
      if (e.key === '1' || e.key === 'ArrowLeft') {
        handleAnswer(false);
      } else if (e.key === '2' || e.key === 'ArrowRight') {
        handleAnswer(true);
      }
    });
  }

  async function loadOxfordA1Pack(silent = false) {
    try {
      const res = await fetch('./oxford-a1.json');
      if (!res.ok) throw new Error('Failed to fetch oxford-a1.json');
      const items = await res.json();
      if (!Array.isArray(items) || !items.length) return;
      importItems(items);
      localStorage.setItem(STORAGE_KEYS.A1_LOADED, 'true');
    } catch {
      if (!silent) {
        showToast('خطا در بارگذاری بسته Oxford A1.');
      }
    }
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  }

  // Init
  loadState();
  bindEvents();
  renderDashboard();
  registerServiceWorker();
  if (!localStorage.getItem(STORAGE_KEYS.A1_LOADED)) {
    loadOxfordA1Pack(true);
  }
})();
