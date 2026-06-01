import { storeGet, storeSet } from './optimisticStore.js';

const LEARN_KEY = 'learning_log_v1';

let deps = {};
let learnEditingId = null;
let urlPreviewTimer = null;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function parseYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  const patterns = [
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];
  for (const re of patterns) {
    const m = u.match(re);
    if (m) return m[1];
  }
  return null;
}

export function detectSourceType(url) {
  if (!url || !url.trim()) return 'other';
  if (parseYouTubeId(url)) return 'youtube';
  if (/^https?:\/\//i.test(url.trim())) return 'article';
  return 'other';
}

function getEntries() {
  const raw = storeGet(LEARN_KEY);
  return Array.isArray(raw) ? raw : [];
}

function saveEntries(entries) {
  storeSet(LEARN_KEY, entries);
}

function sourceLabel(type) {
  if (type === 'youtube') return 'YouTube';
  if (type === 'article') return 'Article';
  return 'Note';
}

function sourceIcon(type) {
  if (type === 'youtube') return '▶';
  if (type === 'article') return '↗';
  return '✦';
}

function parseTags(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.split(',').map(t => t.trim()).filter(Boolean).slice(0, 8);
}

function formatTags(tags) {
  return Array.isArray(tags) ? tags.join(', ') : '';
}

function entrySnippet(entry) {
  if (entry.title?.trim()) return entry.title.trim();
  if (entry.notes?.trim()) return entry.notes.trim().slice(0, 80);
  if (entry.sourceUrl?.trim()) return entry.sourceUrl.trim();
  return 'Untitled entry';
}

function clearComposer() {
  learnEditingId = null;
  const title = document.getElementById('learnTitleInput');
  const url = document.getElementById('learnUrlInput');
  const notes = document.getElementById('learnNotesInput');
  const tags = document.getElementById('learnTagsInput');
  if (title) title.value = '';
  if (url) url.value = '';
  if (notes) notes.value = '';
  if (tags) tags.value = '';
  updateUrlPreview('');
  const cancel = document.getElementById('learnCancelEdit');
  if (cancel) cancel.classList.add('hidden');
  const save = document.getElementById('learnSaveBtn');
  if (save) save.textContent = 'Save entry';
}

function collectComposerForm() {
  return {
    title: document.getElementById('learnTitleInput')?.value.trim() || '',
    sourceUrl: document.getElementById('learnUrlInput')?.value.trim() || '',
    notes: document.getElementById('learnNotesInput')?.value.trim() || '',
    tags: parseTags(document.getElementById('learnTagsInput')?.value || ''),
  };
}

function hasEntryContent(form) {
  return !!(form.title || form.sourceUrl || form.notes || form.tags.length);
}

function updateUrlPreview(url) {
  const wrap = document.getElementById('learnVideoPreview');
  if (!wrap) return;
  wrap.innerHTML = '';
  const id = parseYouTubeId(url);
  if (!id) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  const shell = document.createElement('div');
  shell.className = 'learn-video-shell';
  const iframe = document.createElement('iframe');
  iframe.className = 'learn-video-iframe';
  iframe.src = `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
  iframe.title = 'YouTube video preview';
  iframe.loading = 'lazy';
  iframe.allow =
    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  shell.appendChild(iframe);
  wrap.appendChild(shell);
}

function buildVideoEmbed(videoId, title) {
  const shell = document.createElement('div');
  shell.className = 'learn-video-shell learn-video-shell--compact';
  const iframe = document.createElement('iframe');
  iframe.className = 'learn-video-iframe';
  iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
  iframe.title = title || 'YouTube video';
  iframe.loading = 'lazy';
  iframe.allow =
    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  shell.appendChild(iframe);
  return shell;
}

function commitLearnSave() {
  const form = collectComposerForm();
  const status = document.getElementById('learnStatus');
  if (!hasEntryContent(form)) {
    if (status) status.textContent = 'Add a title, link, or notes before saving';
    return;
  }

  const now = Date.now();
  const today = deps.getActiveDateString();
  const entries = getEntries();
  const sourceType = detectSourceType(form.sourceUrl);

  if (learnEditingId) {
    const idx = entries.findIndex(e => e.id === learnEditingId);
    if (idx >= 0) {
      entries[idx] = {
        ...entries[idx],
        ...form,
        sourceType,
        updatedAt: now,
      };
    }
  } else {
    entries.unshift({
      id: 'le_' + now,
      date: today,
      ...form,
      sourceType,
      createdAt: now,
      updatedAt: now,
    });
  }

  entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  saveEntries(entries);
  clearComposer();
  if (status) {
    status.textContent = 'Saved';
    status.classList.add('is-saved');
    setTimeout(() => {
      status.textContent = 'Log what you learned — links embed automatically';
      status.classList.remove('is-saved');
    }, 2200);
  }
  loadLearn();
}

function beginEditEntry(entry) {
  learnEditingId = entry.id;
  const title = document.getElementById('learnTitleInput');
  const url = document.getElementById('learnUrlInput');
  const notes = document.getElementById('learnNotesInput');
  const tags = document.getElementById('learnTagsInput');
  if (title) title.value = entry.title || '';
  if (url) url.value = entry.sourceUrl || '';
  if (notes) notes.value = entry.notes || '';
  if (tags) tags.value = formatTags(entry.tags);
  updateUrlPreview(entry.sourceUrl || '');
  document.getElementById('learnCancelEdit')?.classList.remove('hidden');
  const save = document.getElementById('learnSaveBtn');
  if (save) save.textContent = 'Update entry';
  document.querySelector('.learn-composer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function deleteEntry(id) {
  saveEntries(getEntries().filter(e => e.id !== id));
  if (learnEditingId === id) clearComposer();
  loadLearn();
}

function buildEntryBody(entry) {
  const body = document.createElement('div');
  body.className = 'learn-history-body';

  const badge = document.createElement('span');
  badge.className = 'learn-source-badge learn-source-badge--' + (entry.sourceType || 'other');
  badge.textContent = sourceIcon(entry.sourceType) + ' ' + sourceLabel(entry.sourceType);
  body.appendChild(badge);

  const videoId = parseYouTubeId(entry.sourceUrl);
  if (videoId) {
    body.appendChild(buildVideoEmbed(videoId, entry.title));
  } else if (entry.sourceUrl) {
    const link = document.createElement('a');
    link.className = 'learn-source-link';
    link.href = entry.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = entry.sourceUrl;
    body.appendChild(link);
  }

  if (entry.notes?.trim()) {
    const notes = document.createElement('div');
    notes.className = 'learn-history-notes';
    notes.textContent = entry.notes;
    body.appendChild(notes);
  }

  if (entry.tags?.length) {
    const tagRow = document.createElement('div');
    tagRow.className = 'learn-tag-row';
    entry.tags.forEach(t => {
      const chip = document.createElement('span');
      chip.className = 'learn-tag-chip';
      chip.textContent = t;
      tagRow.appendChild(chip);
    });
    body.appendChild(tagRow);
  }

  const actions = document.createElement('div');
  actions.className = 'learn-history-actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'learn-history-action';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    beginEditEntry(entry);
  });
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'learn-history-action learn-history-action--danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteEntry(entry.id);
  });
  actions.appendChild(editBtn);
  actions.appendChild(delBtn);
  body.appendChild(actions);
  return body;
}

function renderTodayEntries(entries, today) {
  const list = document.getElementById('learnTodayList');
  if (!list) return;
  list.innerHTML = '';
  const todayEntries = entries.filter(e => e.date === today);
  const titleEl = document.getElementById('learnTodayTitle');
  if (titleEl) titleEl.classList.toggle('hidden', todayEntries.length === 0);

  todayEntries.forEach(entry => {
    const card = document.createElement('article');
    card.className = 'learn-entry-card';
    const head = document.createElement('div');
    head.className = 'learn-entry-head';
    head.innerHTML = `
      <span class="learn-entry-title">${escapeHtml(entry.title || entrySnippet(entry))}</span>
      <span class="learn-source-badge learn-source-badge--${entry.sourceType || 'other'}">${sourceIcon(entry.sourceType)} ${sourceLabel(entry.sourceType)}</span>`;
    card.appendChild(head);

    const videoId = parseYouTubeId(entry.sourceUrl);
    if (videoId) card.appendChild(buildVideoEmbed(videoId, entry.title));
    else if (entry.sourceUrl) {
      const link = document.createElement('a');
      link.className = 'learn-source-link';
      link.href = entry.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = entry.sourceUrl;
      card.appendChild(link);
    }
    if (entry.notes?.trim()) {
      const p = document.createElement('p');
      p.className = 'learn-entry-notes';
      p.textContent = entry.notes;
      card.appendChild(p);
    }
    card.addEventListener('click', () => beginEditEntry(entry));
    list.appendChild(card);
  });
}

function renderHistory(entries, today) {
  const hist = document.getElementById('learnHistoryList');
  if (!hist) return;
  hist.innerHTML = '';

  const dates = [...new Set(entries.map(e => e.date))].sort((a, b) => b.localeCompare(a));
  if (dates.length === 0) {
    const p = document.createElement('div');
    p.className = 'empty-state';
    p.textContent = 'Your learning log builds here — save entries to revisit them anytime.';
    hist.appendChild(p);
    return;
  }

  dates.slice(0, 40).forEach(ds => {
    const dayEntries = entries.filter(e => e.date === ds);
    const group = document.createElement('div');
    group.className = 'learn-history-day';

    const dayHead = document.createElement('div');
    dayHead.className = 'learn-history-day-label';
    dayHead.textContent = ds === today ? 'Today' : deps.formatDate(ds);
    group.appendChild(dayHead);

    dayEntries.forEach(entry => {
      const card = document.createElement('div');
      card.className = 'learn-history-item' + (learnEditingId === entry.id ? ' is-active' : '');

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'learn-history-head';
      head.innerHTML = `
        <span class="learn-history-head-main">
          <span class="learn-history-title">${escapeHtml(entry.title || entrySnippet(entry))}</span>
          <span class="learn-history-snippet">${escapeHtml(entry.notes?.slice(0, 72) || entry.sourceUrl || '')}</span>
        </span>
        <span class="learn-history-chevron">▼</span>`;

      head.addEventListener('click', (e) => {
        if (e.target.closest('.learn-history-action')) return;
        const open = card.classList.toggle('is-expanded');
        hist.querySelectorAll('.learn-history-item').forEach(el => {
          if (el !== card) el.classList.remove('is-expanded');
        });
        if (!open) card.classList.remove('is-expanded');
      });

      card.appendChild(head);
      card.appendChild(buildEntryBody(entry));
      group.appendChild(card);
    });

    hist.appendChild(group);
  });
}

export function loadLearn() {
  if (!deps.getActiveDateString) return;
  const today = deps.getActiveDateString();
  const entries = getEntries();

  const label = document.getElementById('learnDateLabel');
  if (label) label.textContent = `Today — ${deps.formatDate(today)}`;

  renderTodayEntries(entries, today);
  renderHistory(entries, today);
}

export function initLearn(dependencies) {
  deps = dependencies;

  document.getElementById('learnSaveBtn')?.addEventListener('click', commitLearnSave);
  document.getElementById('learnCancelEdit')?.addEventListener('click', () => {
    clearComposer();
    const status = document.getElementById('learnStatus');
    if (status) status.textContent = 'Log what you learned — links embed automatically';
  });

  const urlInput = document.getElementById('learnUrlInput');
  urlInput?.addEventListener('input', () => {
    if (urlPreviewTimer) clearTimeout(urlPreviewTimer);
    urlPreviewTimer = setTimeout(() => updateUrlPreview(urlInput.value), 280);
  });
  urlInput?.addEventListener('paste', () => {
    setTimeout(() => updateUrlPreview(urlInput.value), 0);
  });

  ['learnTitleInput', 'learnNotesInput', 'learnTagsInput'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        commitLearnSave();
      }
    });
  });
}
