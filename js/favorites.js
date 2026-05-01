'use strict';

const Favorites = {
  state: {
    items: [],
    searchQuery: '',
    categoryFilter: 'all',
    wakeLock: null,
  },

  db: null,
  storage: null,
  householdId: null,

  init(db, storage, householdId) {
    this.db = db;
    this.storage = storage;
    this.householdId = householdId;
  },

  colRef() {
    return this.db.collection('households').doc(this.householdId).collection('favorites');
  },

  async load() {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('お気に入りの読み込みタイムアウト')), 10000)
    );
    const snap = await Promise.race([
      this.colRef().orderBy('createdAt', 'desc').get().catch(() => this.colRef().get()),
      timeout,
    ]);
    this.state.items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async save(data, id) {
    if (id) {
      await this.colRef().doc(id).update({ ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      const idx = this.state.items.findIndex(i => i.id === id);
      if (idx >= 0) this.state.items[idx] = { ...this.state.items[idx], ...data };
    } else {
      const ref = this.colRef().doc();
      const doc = { ...data, id: ref.id, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
      await ref.set(doc);
      this.state.items.unshift(doc);
    }
  },

  async remove(id) {
    const item = this.state.items.find(i => i.id === id);
    if (item && item.photoUrl && this.storage) {
      try {
        const photoRef = this.storage.refFromURL(item.photoUrl);
        await photoRef.delete();
      } catch (_) {}
    }
    await this.colRef().doc(id).delete();
    this.state.items = this.state.items.filter(i => i.id !== id);
  },

  async uploadPhoto(file, recipeId) {
    if (!this.storage) throw new Error('Storage が初期化されていません');
    const ext = file.name.split('.').pop();
    const path = `favorites/${this.householdId}/${recipeId}/${Date.now()}.${ext}`;
    const ref = this.storage.ref(path);
    const snap = await ref.put(file);
    return await snap.ref.getDownloadURL();
  },

  filteredItems() {
    let list = [...this.state.items];
    if (this.state.categoryFilter !== 'all') {
      list = list.filter(i => i.category === this.state.categoryFilter);
    }
    if (this.state.searchQuery.trim()) {
      const q = this.state.searchQuery.trim().toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q));
    }
    return list;
  },

  starsHtml(rating, interactive) {
    let html = '';
    for (let s = 1; s <= 5; s++) {
      if (interactive) {
        html += `<button type="button" class="fav-star${s <= (rating || 0) ? ' active' : ''}" data-star="${s}">★</button>`;
      } else {
        html += `<span class="fav-star-display${s <= (rating || 0) ? ' active' : ''}">★</span>`;
      }
    }
    return html;
  },

  categoryBadgeClass(cat) {
    const map = { '和食': 'badge-washoku', '洋食': 'badge-yoshoku', '中華': 'badge-chuka', 'その他': 'badge-other' };
    return map[cat] || 'badge-other';
  },

  renderList() {
    const view = document.getElementById('favorites-view');
    if (!view) return;

    const items = this.filteredItems();
    const grid = document.getElementById('fav-grid');
    grid.innerHTML = '';

    if (items.length === 0) {
      grid.innerHTML = '<p class="fav-empty">レシピがありません</p>';
      return;
    }

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'fav-card';
      const badgeClass = this.categoryBadgeClass(item.category);

      card.innerHTML = `
        ${item.photoUrl ? `<div class="fav-card-photo"><img src="${item.photoUrl}" alt="${item.name}"></div>` : '<div class="fav-card-photo fav-card-photo-empty"><span>📷</span></div>'}
        <div class="fav-card-body">
          <div class="fav-card-name">${item.name}</div>
          <div class="fav-card-meta">
            <span class="badge ${badgeClass}">${item.category || 'その他'}</span>
            <span class="fav-stars-small">${this.starsHtml(item.rating, false)}</span>
          </div>
        </div>`;

      card.addEventListener('click', () => this.openDetail(item.id));
      grid.appendChild(card);
    });
  },

  openList() {
    this.renderList();
    document.getElementById('favorites-view').classList.remove('hidden');
  },

  openDetail(id) {
    const item = this.state.items.find(i => i.id === id);
    if (!item) return;

    const view = document.getElementById('fav-detail-view');
    const badgeClass = this.categoryBadgeClass(item.category);

    document.getElementById('fav-detail-name').textContent = item.name;
    document.getElementById('fav-detail-badge').className = `badge ${badgeClass}`;
    document.getElementById('fav-detail-badge').textContent = item.category || 'その他';
    document.getElementById('fav-detail-stars').innerHTML = this.starsHtml(item.rating, false);
    document.getElementById('fav-detail-memo').textContent = item.memo || '';
    document.getElementById('fav-detail-memo-wrap').classList.toggle('hidden', !item.memo);

    const recipeBlock = document.getElementById('fav-detail-recipe-block');
    if (item.recipeUrl) {
      document.getElementById('fav-detail-recipe-url').href = item.recipeUrl;
      document.getElementById('fav-detail-recipe-url').textContent = item.recipeUrl;
      recipeBlock.classList.remove('hidden');
    } else {
      recipeBlock.classList.add('hidden');
    }

    const manualBlock = document.getElementById('fav-detail-manual-block');
    if (item.recipeText) {
      document.getElementById('fav-detail-recipe-text').textContent = item.recipeText;
      manualBlock.classList.remove('hidden');
    } else {
      manualBlock.classList.add('hidden');
    }

    const tagsEl = document.getElementById('fav-detail-tags');
    if (item.ingredients && item.ingredients.length > 0) {
      tagsEl.innerHTML = item.ingredients.map(tid => {
        const tag = INGREDIENT_TAGS.find(t => t.id === tid);
        return tag ? `<span class="badge badge-other">${tag.label}</span>` : '';
      }).join('');
      document.getElementById('fav-detail-tags-wrap').classList.remove('hidden');
    } else {
      document.getElementById('fav-detail-tags-wrap').classList.add('hidden');
    }

    const photoEl = document.getElementById('fav-detail-photo');
    const photoWrap = document.getElementById('fav-detail-photo-wrap');
    if (item.photoUrl) {
      photoEl.src = item.photoUrl;
      photoWrap.classList.remove('hidden');
    } else {
      photoWrap.classList.add('hidden');
    }

    document.getElementById('fav-detail-btn-edit').dataset.id = id;
    document.getElementById('fav-detail-btn-delete').dataset.id = id;

    document.getElementById('fav-detail-view').classList.remove('hidden');
    document.getElementById('favorites-view').classList.add('hidden');

    this.acquireWakeLock();
  },

  closeDetail() {
    document.getElementById('fav-detail-view').classList.add('hidden');
    document.getElementById('favorites-view').classList.remove('hidden');
    this.releaseWakeLock();
  },

  openForm(id) {
    const item = id ? this.state.items.find(i => i.id === id) : null;
    document.getElementById('fav-form-title').textContent = item ? 'レシピを編集' : 'レシピを追加';
    document.getElementById('fav-edit-id').value = id || '';
    document.getElementById('fav-form-name').value = item ? item.name : '';
    document.getElementById('fav-form-recipe-url').value = item && item.recipeUrl ? item.recipeUrl : '';
    document.getElementById('fav-form-recipe-text').value = item ? (item.recipeText || '') : '';
    document.getElementById('fav-form-memo').value = item ? (item.memo || '') : '';

    const photoPreview = document.getElementById('fav-photo-preview');
    const photoPreviewWrap = document.getElementById('fav-photo-preview-wrap');
    if (item && item.photoUrl) {
      photoPreview.src = item.photoUrl;
      photoPreviewWrap.classList.remove('hidden');
    } else {
      photoPreviewWrap.classList.add('hidden');
    }
    document.getElementById('fav-form-photo').value = '';

    const catBtns = document.querySelectorAll('.fav-cat-btn');
    const currentCat = item ? (item.category || '和食') : '和食';
    catBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.cat === currentCat));

    const currentRating = item ? (item.rating || 0) : 0;
    document.querySelectorAll('.fav-star-input').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.star) <= currentRating);
    });

    const grid = document.getElementById('fav-ing-grid');
    grid.innerHTML = '';
    const selected = item ? (item.ingredients || []) : [];
    INGREDIENT_TAGS.forEach(tag => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ingredient-check' + (selected.includes(tag.id) ? ' checked' : '');
      btn.textContent = tag.label;
      btn.dataset.id = tag.id;
      btn.addEventListener('click', () => btn.classList.toggle('checked'));
      grid.appendChild(btn);
    });

    document.getElementById('fav-form-view').classList.remove('hidden');
    document.getElementById('favorites-view').classList.add('hidden');
    document.getElementById('fav-detail-view').classList.add('hidden');
  },

  closeForm() {
    document.getElementById('fav-form-view').classList.add('hidden');
    if (document.getElementById('fav-edit-id').value) {
      const id = document.getElementById('fav-edit-id').value;
      this.openDetail(id);
    } else {
      document.getElementById('favorites-view').classList.remove('hidden');
    }
  },

  async submitForm(e) {
    e.preventDefault();
    const id = document.getElementById('fav-edit-id').value || null;
    const name = document.getElementById('fav-form-name').value.trim();
    if (!name) return;

    const category = document.querySelector('.fav-cat-btn.active')?.dataset.cat || '和食';
    let ratingVal = 0;
    document.querySelectorAll('.fav-star-input').forEach(b => {
      if (b.classList.contains('active')) ratingVal = Math.max(ratingVal, parseInt(b.dataset.star));
    });

    const ingredients = Array.from(
      document.querySelectorAll('#fav-ing-grid .ingredient-check.checked')
    ).map(b => b.dataset.id);

    const data = {
      name,
      category,
      rating: ratingVal,
      recipeUrl: document.getElementById('fav-form-recipe-url').value.trim() || null,
      recipeText: document.getElementById('fav-form-recipe-text').value.trim() || null,
      memo: document.getElementById('fav-form-memo').value.trim() || null,
      ingredients,
    };

    App.showOverlay(true);
    try {
      const recipeId = id || ('fav_' + Date.now().toString(36));

      const photoFile = document.getElementById('fav-form-photo').files[0];
      if (photoFile) {
        data.photoUrl = await this.uploadPhoto(photoFile, recipeId);
      } else if (id) {
        const existing = this.state.items.find(i => i.id === id);
        if (existing && existing.photoUrl) data.photoUrl = existing.photoUrl;
      }

      await this.save(data, id);

      document.getElementById('fav-form-view').classList.add('hidden');
      if (id) {
        this.openDetail(id);
      } else {
        document.getElementById('favorites-view').classList.remove('hidden');
        this.renderList();
      }
      App.showSnack(id ? '更新しました' : '追加しました');
    } catch (err) {
      alert('保存に失敗しました: ' + err.message);
    } finally {
      App.showOverlay(false);
    }
  },

  async deleteItem(id) {
    App.confirm(`このレシピを削除しますか？`, async () => {
      App.showOverlay(true);
      try {
        await this.remove(id);
        document.getElementById('fav-detail-view').classList.add('hidden');
        document.getElementById('favorites-view').classList.remove('hidden');
        this.renderList();
        App.showSnack('削除しました');
      } catch (err) {
        alert('削除に失敗しました: ' + err.message);
      } finally {
        App.showOverlay(false);
      }
    });
  },

  async acquireWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this.state.wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) {}
  },

  async releaseWakeLock() {
    if (this.state.wakeLock) {
      try { await this.state.wakeLock.release(); } catch (_) {}
      this.state.wakeLock = null;
    }
  },

  setupEventListeners() {
    document.getElementById('fav-search').addEventListener('input', e => {
      this.state.searchQuery = e.target.value;
      this.renderList();
    });

    document.querySelectorAll('.fav-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fav-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.categoryFilter = btn.dataset.cat;
        this.renderList();
      });
    });

    document.getElementById('fav-fab').addEventListener('click', () => this.openForm(null));

    document.getElementById('fav-detail-btn-back').addEventListener('click', () => this.closeDetail());
    document.getElementById('fav-detail-btn-edit').addEventListener('click', e => {
      const id = e.currentTarget.dataset.id;
      this.openForm(id);
    });
    document.getElementById('fav-detail-btn-delete').addEventListener('click', e => {
      const id = e.currentTarget.dataset.id;
      this.deleteItem(id);
    });

    document.getElementById('fav-detail-photo').addEventListener('click', () => {
      document.getElementById('fav-photo-modal-img').src = document.getElementById('fav-detail-photo').src;
      document.getElementById('fav-photo-modal').classList.remove('hidden');
    });
    document.getElementById('fav-photo-modal-overlay').addEventListener('click', () => {
      document.getElementById('fav-photo-modal').classList.add('hidden');
    });

    document.getElementById('fav-detail-btn-fulltext').addEventListener('click', () => {
      const text = document.getElementById('fav-detail-recipe-text').textContent;
      document.getElementById('fav-fulltext-content').textContent = text;
      document.getElementById('fav-fulltext-modal').classList.remove('hidden');
    });
    document.getElementById('fav-fulltext-modal-overlay').addEventListener('click', () => {
      document.getElementById('fav-fulltext-modal').classList.add('hidden');
    });
    document.getElementById('fav-fulltext-close').addEventListener('click', () => {
      document.getElementById('fav-fulltext-modal').classList.add('hidden');
    });

    document.getElementById('fav-form-btn-cancel').addEventListener('click', () => this.closeForm());
    document.getElementById('fav-form-btn-cancel2').addEventListener('click', () => this.closeForm());
    document.getElementById('fav-form').addEventListener('submit', e => this.submitForm(e));

    document.getElementById('fav-form-photo').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        document.getElementById('fav-photo-preview').src = ev.target.result;
        document.getElementById('fav-photo-preview-wrap').classList.remove('hidden');
      };
      reader.readAsDataURL(file);
    });

    document.querySelectorAll('.fav-cat-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fav-cat-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.querySelectorAll('.fav-star-input').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.dataset.star);
        document.querySelectorAll('.fav-star-input').forEach(b => {
          b.classList.toggle('active', parseInt(b.dataset.star) <= val);
        });
      });
    });

    document.getElementById('fav-form-btn-photo').addEventListener('click', () => {
      document.getElementById('fav-form-photo').click();
    });
  },
};
