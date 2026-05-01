'use strict';

// ============================================================
// 定数
// ============================================================
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner'];
const MEAL_LABELS = { breakfast: '朝食', lunch: '昼食', dinner: '夕食' };
const MEAL_HEADER_CLASSES = {
  breakfast: 'meal-header-breakfast',
  lunch:     'meal-header-lunch',
  dinner:    'meal-header-dinner',
};
const DAY_LABELS = ['日','月','火','水','木','金','土'];
const CATEGORY_BADGE = {
  '和食': 'badge-washoku',
  '洋食': 'badge-yoshoku',
  '中華': 'badge-chuka',
  'その他': 'badge-other',
};

// ============================================================
// アプリ本体
// ============================================================
const App = {
  // ----- 状態 -----
  state: {
    year:  new Date().getFullYear(),
    month: new Date().getMonth() + 1,
    sortAsc: true,
    dishes: [],          // 全献立データ
    mealPlan: {},        // { 'YYYY-MM-DD': { breakfast:{main,side1,side2}, ... } }
    householdId: null,
    shareCode: null,
    currentView: 'monthly',   // monthly | daily | db | settings
    selectedDate: null,
    activeDbType: 'main',
    ingredientFilter: [],     // 選択中の食材タグ
    user: null,
    mealPlanUnsub: null,      // Firestoreリスナー解除関数
    confirmCallback: null,
<<<<<<< HEAD
    dishSelectContext: null,  // { dateKey, mealType, field, dishType }
    addFromSelectModal: false,// 献立選択モーダルから新規追加フラグ
    dbSearchQuery: '',        // 献立DBの検索クエリ
    dbMealTimeFilter: 'all',  // all | morning | lunch_dinner
    dishActionContext: null,  // { dateKey, mealType, field }
=======
>>>>>>> f7a83d2d861a1e53b3290c0727ec894bf3c42a17
  },
  db:   null,
  auth: null,

  // ============================================================
  // 初期化
  // ============================================================
  async init() {
    try {
      firebase.initializeApp(window.firebaseConfig);
      this.db   = firebase.firestore();
      this.auth = firebase.auth();
    } catch (e) {
      this.showScreen('auth');
      alert('Firebase設定が見つかりません。js/config.js を確認してください。\n' + e.message);
      return;
    }

    this.setupEventListeners();

    this.auth.onAuthStateChanged(user => this.handleAuthState(user));

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  },

  // ============================================================
  // 認証
  // ============================================================
  async handleAuthState(user) {
    if (!user) {
      this.showScreen('auth');
      return;
    }
    this.state.user = user;

    // 世帯IDを確認
    const userDoc = await this.db.collection('users').doc(user.uid).get();
    if (userDoc.exists && userDoc.data().householdId) {
      this.state.householdId = userDoc.data().householdId;
      this.state.shareCode   = userDoc.data().shareCode || null;
      await this.startApp();
    } else {
      this.showScreen('household');
    }
  },

  async signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
      await this.auth.signInWithPopup(provider);
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') alert('ログインに失敗しました: ' + e.message);
    }
  },

  async signOut() {
    this.confirm('ログアウトしますか？', async () => {
      if (this.state.mealPlanUnsub) this.state.mealPlanUnsub();
      await this.auth.signOut();
    });
  },

  // ============================================================
  // 世帯管理
  // ============================================================
  async createHousehold() {
    this.showOverlay(true);
    try {
      const householdId = this.generateId();
      const shareCode   = householdId.slice(0, 6).toUpperCase();
      const user        = this.state.user;

      await this.db.collection('households').doc(householdId).set({
        createdBy: user.uid,
        shareCode,
        members: [user.uid],
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      // 初期献立データを投入
      await this.seedDishes(householdId);

      await this.db.collection('users').doc(user.uid).set({
        householdId,
        shareCode,
        email: user.email,
      });

      this.state.householdId = householdId;
      this.state.shareCode   = shareCode;
      await this.startApp();
    } catch (e) {
      alert('作成に失敗しました: ' + e.message);
    } finally {
      this.showOverlay(false);
    }
  },

  async joinHousehold(code) {
    if (!code || code.length < 6) { alert('共有コードを正しく入力してください'); return; }
    this.showOverlay(true);
    try {
      const snap = await this.db.collection('households')
        .where('shareCode', '==', code.toUpperCase()).get();
      if (snap.empty) { alert('共有コードが見つかりません'); return; }

      const householdDoc = snap.docs[0];
      const householdId  = householdDoc.id;
      const shareCode    = householdDoc.data().shareCode;
      const user         = this.state.user;

      await this.db.collection('households').doc(householdId).update({
        members: firebase.firestore.FieldValue.arrayUnion(user.uid),
      });
      await this.db.collection('users').doc(user.uid).set({
        householdId,
        shareCode,
        email: user.email,
      });

      this.state.householdId = householdId;
      this.state.shareCode   = shareCode;
      await this.startApp();
    } catch (e) {
      alert('参加に失敗しました: ' + e.message);
    } finally {
      this.showOverlay(false);
    }
  },

  async seedDishes(householdId) {
    const ref   = this.db.collection('households').doc(householdId).collection('dishes');
    const batch = this.db.batch();
    INITIAL_DISHES.forEach(dish => {
      const d = ref.doc();
      batch.set(d, { ...dish, id: d.id, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await batch.commit();
  },

  // ============================================================
  // アプリ起動
  // ============================================================
  async startApp() {
    await this.loadDishes();
    this.subscribeToMealPlan();
    Favorites.init(this.db, firebase.storage(), this.state.householdId);
    Favorites.setupEventListeners();
    await Favorites.load();
    this.showScreen('app');
    this.showView('monthly');
    this.renderMonthlyView();
  },

  // ============================================================
  // 献立データ（Firestore）
  // ============================================================
  async loadDishes() {
    const snap = await this.db.collection('households')
      .doc(this.state.householdId).collection('dishes').get();
    this.state.dishes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    this.state.dishes.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  },

  subscribeToMealPlan() {
    if (this.state.mealPlanUnsub) this.state.mealPlanUnsub();
    const { year, month } = this.state;
    const from = `${year}-${this.pad(month)}-01`;
    const to   = `${year}-${this.pad(month)}-31`;

    this.state.mealPlanUnsub = this.db
      .collection('households').doc(this.state.householdId)
      .collection('mealPlan')
      .where(firebase.firestore.FieldPath.documentId(), '>=', from)
      .where(firebase.firestore.FieldPath.documentId(), '<=', to)
      .onSnapshot(snap => {
        snap.docChanges().forEach(change => {
          if (change.type === 'removed') {
            delete this.state.mealPlan[change.doc.id];
          } else {
            this.state.mealPlan[change.doc.id] = change.doc.data();
          }
        });
        this.renderMonthlyView();
        if (this.state.currentView === 'daily' && this.state.selectedDate) {
          this.renderDailyView(this.state.selectedDate);
        }
      });
  },

  async saveMeal(dateKey, mealType, mealData) {
    const ref = this.db.collection('households').doc(this.state.householdId)
      .collection('mealPlan').doc(dateKey);
    await ref.set({ [mealType]: mealData }, { merge: true });
  },

  // ============================================================
  // 献立DB CRUD
  // ============================================================
  async saveDish(data, id) {
    const colRef = this.db.collection('households').doc(this.state.householdId).collection('dishes');
    if (id) {
      await colRef.doc(id).update(data);
      const idx = this.state.dishes.findIndex(d => d.id === id);
      if (idx >= 0) this.state.dishes[idx] = { ...this.state.dishes[idx], ...data };
    } else {
      const ref = colRef.doc();
      const doc = { ...data, id: ref.id, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
      await ref.set(doc);
      this.state.dishes.push(doc);
      this.state.dishes.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    }
  },

  async deleteDish(id) {
    await this.db.collection('households').doc(this.state.householdId)
      .collection('dishes').doc(id).delete();
    this.state.dishes = this.state.dishes.filter(d => d.id !== id);
  },

  // ============================================================
  // ランダム生成
  // ============================================================

  // 過去 n 日間に使用した dishId を返す
  getRecentIds(dateKey, days, type) {
    const ids = new Set();
    const base = new Date(dateKey);
    for (let i = 1; i <= days; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const k = this.dateToKey(d);
      const plan = this.state.mealPlan[k];
      if (!plan) continue;
      MEAL_TYPES.forEach(mt => {
        const m = plan[mt];
        if (!m) return;
        if (type === 'main' && m.main)  ids.add(m.main);
        if (type === 'side' && m.side1) ids.add(m.side1);
        if (type === 'side' && m.side2) ids.add(m.side2);
      });
    }
    return ids;
  },

  pickDish(type, excludeIds, filter) {
    let pool = this.state.dishes.filter(d => d.type === type && !excludeIds.has(d.id));
    if (filter && filter.length > 0) {
      const filtered = pool.filter(d => filter.some(f => (d.ingredients || []).includes(f)));
      if (filtered.length > 0) pool = filtered;
    }
    if (pool.length === 0) {
      pool = this.state.dishes.filter(d => d.type === type);
    }
    return pool[Math.floor(Math.random() * pool.length)] || null;
  },

  // 1食分（主菜・副菜1・副菜2）をランダム生成
  generateOneMeal(dateKey, excludeMain, excludeSide, filter) {
    const main  = this.pickDish('main', excludeMain, filter);
    const used  = new Set(excludeSide);
    const side1 = this.pickDish('side', used, []);
    if (side1) used.add(side1.id);
    const side2 = this.pickDish('side', used, []);
    return {
      main:  main  ? main.id  : null,
      side1: side1 ? side1.id : null,
      side2: side2 ? side2.id : null,
    };
  },

  // 1日（朝昼夕）をランダム生成してFirestoreに保存
  async generateDay(dateKey, filter) {
    this.showOverlay(true);
    try {
      const exMain = this.getRecentIds(dateKey, 5, 'main');
      const exSide = this.getRecentIds(dateKey, 3, 'side');
      const meals  = {};

      MEAL_TYPES.forEach(mt => {
        const m = this.generateOneMeal(dateKey, exMain, exSide, filter);
        meals[mt] = m;
        if (m.main)  exMain.add(m.main);
        if (m.side1) exSide.add(m.side1);
        if (m.side2) exSide.add(m.side2);
      });

      const ref = this.db.collection('households').doc(this.state.householdId)
        .collection('mealPlan').doc(dateKey);
      await ref.set(meals);
      this.state.mealPlan[dateKey] = meals;
      this.showSnack('献立を生成しました');
    } finally {
      this.showOverlay(false);
    }
  },

  // 1食分だけ置き換え（カスタム名もクリア）
  async generateOneMealAndSave(dateKey, mealType, filter) {
    const exMain = this.getRecentIds(dateKey, 5, 'main');
    const exSide = this.getRecentIds(dateKey, 3, 'side');
<<<<<<< HEAD
    const m = this.generateOneMeal(dateKey, exMain, exSide, filter, mealType);
    await this.saveMeal(dateKey, mealType, {
      ...m, mainCustom: null, side1Custom: null, side2Custom: null,
    });
=======
    const m = this.generateOneMeal(dateKey, exMain, exSide, filter);
    await this.saveMeal(dateKey, mealType, m);
>>>>>>> f7a83d2d861a1e53b3290c0727ec894bf3c42a17
    this.showSnack('献立を変更しました');
  },

  // 1品だけ置き換え（カスタム名もクリア）
  async generateOneDishAndSave(dateKey, mealType, dishField, filter) {
    const cur   = (this.state.mealPlan[dateKey] || {})[mealType] || {};
    const exIds = new Set([cur.main, cur.side1, cur.side2].filter(Boolean));
    const type  = dishField === 'main' ? 'main' : 'side';
    const dish  = this.pickDish(type, exIds, type === 'main' ? filter : []);
    if (!dish) return;
    const updated = { ...cur, [dishField]: dish.id, [dishField + 'Custom']: null };
    await this.saveMeal(dateKey, mealType, updated);
    this.showSnack('献立を変更しました');
  },

  // 月全体をランダム生成
  async generateMonth() {
    this.confirm(`${this.state.year}年${this.state.month}月の献立を全てランダム生成します。\n現在の献立は上書きされます。よろしいですか？`, async () => {
      this.showOverlay(true);
      try {
        const { year, month } = this.state;
        const days = new Date(year, month, 0).getDate();
        const batch = this.db.batch();
        const colRef = this.db.collection('households').doc(this.state.householdId).collection('mealPlan');
        const localPlan = { ...this.state.mealPlan };

        const exMain = new Set();
        const exSide = new Set();

        // 月初前のデータから重複回避リストを作る
        const prevKey = this.dateToKey(new Date(year, month - 1, 0));
        const pre = this.getRecentIds(prevKey, 5, 'main');
        pre.forEach(id => exMain.add(id));

        for (let day = 1; day <= days; day++) {
          const dateKey = `${year}-${this.pad(month)}-${this.pad(day)}`;
          const meals   = {};

          MEAL_TYPES.forEach(mt => {
            const m = this.generateOneMeal(dateKey, exMain, exSide, []);
            meals[mt] = m;
            if (m.main)  exMain.add(m.main);
            if (m.side1) exSide.add(m.side1);
            if (m.side2) exSide.add(m.side2);
            // 5日分だけ保持
            if (exMain.size > 15) {
              const [first] = exMain;
              exMain.delete(first);
            }
            if (exSide.size > 9) {
              const [first] = exSide;
              exSide.delete(first);
            }
          });

          localPlan[dateKey] = meals;
          batch.set(colRef.doc(dateKey), meals);
        }

        await batch.commit();
        Object.assign(this.state.mealPlan, localPlan);
        this.renderMonthlyView();
        this.showSnack(`${month}月の献立を生成しました`);
      } catch (e) {
        alert('生成に失敗しました: ' + e.message);
      } finally {
        this.showOverlay(false);
      }
    });
  },

  // ============================================================
  // 月次ビュー描画
  // ============================================================
  renderMonthlyView() {
    const { year, month, sortAsc } = this.state;
    const days    = new Date(year, month, 0).getDate();
    const tbody   = document.getElementById('meal-table-body');
    const title   = document.getElementById('month-title');
    title.textContent = `${year}年${month}月`;

    const dayNums = Array.from({ length: days }, (_, i) => i + 1);
    if (!sortAsc) dayNums.reverse();

    tbody.innerHTML = '';
    dayNums.forEach(day => {
      const dateKey  = `${year}-${this.pad(month)}-${this.pad(day)}`;
      const dateObj  = new Date(year, month - 1, day);
      const dow      = dateObj.getDay();
      const holiday  = Holidays.getName(year, month, day);
      const isHoliday = holiday !== null;

      const tr = document.createElement('tr');
      if (isHoliday) tr.classList.add('holiday-bg');
      tr.dataset.date = dateKey;

      // 日付セル
      let dowClass = '';
      if (dow === 0 || isHoliday) dowClass = 'dow-sun';
      else if (dow === 6)          dowClass = 'dow-sat';

      tr.innerHTML = `
        <td class="date-cell">
          <div class="date-num ${dowClass}">${day}</div>
          <div class="date-dow ${dowClass}">${DAY_LABELS[dow]}</div>
          ${holiday ? `<div class="date-holiday">${holiday}</div>` : ''}
        </td>
        ${MEAL_TYPES.map(mt => {
          const plan  = (this.state.mealPlan[dateKey] || {})[mt];
          const main  = this.getMealEntry(plan, 'main');
          const side1 = this.getMealEntry(plan, 'side1');
          const side2 = this.getMealEntry(plan, 'side2');
          return `
            <td class="meal-cell">
              <div class="meal-cell-inner">
                <div class="dish-tag main-tag">${main.name  ? this.trunc(main.name,  10) : '未設定'}</div>
                <div class="dish-tag">${side1.name ? this.trunc(side1.name, 10) : ''}</div>
                <div class="dish-tag">${side2.name ? this.trunc(side2.name, 10) : ''}</div>
              </div>
            </td>`;
        }).join('')}`;

      tr.addEventListener('click', () => this.openDailyView(dateKey));
      tbody.appendChild(tr);
    });
  },

  // ============================================================
  // 日別詳細ビュー
  // ============================================================
  openDailyView(dateKey) {
    this.state.selectedDate = dateKey;
    this.showView('daily');
    this.renderDailyView(dateKey);
  },

  renderDailyView(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const dateObj   = new Date(y, m - 1, d);
    const dow       = DAY_LABELS[dateObj.getDay()];
    const holiday   = Holidays.getName(y, m, d);
    document.getElementById('daily-date-title').textContent =
      `${m}月${d}日（${dow}）${holiday ? ' ' + holiday : ''}`;

    // 食材フィルタータグ
    const tagContainer = document.getElementById('ingredient-tags');
    tagContainer.innerHTML = '';
    INGREDIENT_TAGS.forEach(tag => {
      const btn = document.createElement('button');
      btn.className = 'ingredient-tag' + (this.state.ingredientFilter.includes(tag.id) ? ' active' : '');
      btn.textContent = tag.label;
      btn.dataset.id  = tag.id;
      btn.addEventListener('click', () => {
        const idx = this.state.ingredientFilter.indexOf(tag.id);
        if (idx >= 0) this.state.ingredientFilter.splice(idx, 1);
        else this.state.ingredientFilter.push(tag.id);
        btn.classList.toggle('active');
      });
      tagContainer.appendChild(btn);
    });

    // 食事カード
    const container = document.getElementById('daily-meals');
    container.innerHTML = '';
    const dayPlan = this.state.mealPlan[dateKey] || {};

    MEAL_TYPES.forEach(mt => {
      const meal  = dayPlan[mt] || {};
      const card  = document.createElement('div');
      card.className = 'meal-card';

      card.innerHTML = `
        <div class="meal-card-header ${MEAL_HEADER_CLASSES[mt]}">
          <h3>${MEAL_LABELS[mt]}</h3>
          <button class="icon-btn icon-btn-sm" data-action="dice-meal" data-mt="${mt}" title="${MEAL_LABELS[mt]}をランダム変更" style="color:#fff;">🎲</button>
        </div>
        <div class="meal-card-body">
          ${this.dishRow('主菜',  meal, 'main',  mt, dateKey)}
          ${this.dishRow('副菜1', meal, 'side1', mt, dateKey)}
          ${this.dishRow('副菜2', meal, 'side2', mt, dateKey)}
        </div>`;

      // 食事全体サイコロ
      card.querySelector('[data-action="dice-meal"]').addEventListener('click', async e => {
        e.stopPropagation();
        await this.generateOneMealAndSave(dateKey, mt, this.state.ingredientFilter);
      });

      // 各品サイコロ
      card.querySelectorAll('[data-action="dice-dish"]').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          await this.generateOneDishAndSave(dateKey, btn.dataset.mt, btn.dataset.field, this.state.ingredientFilter);
        });
      });
<<<<<<< HEAD

      // 献立名タップ → アクションモーダル
      card.querySelectorAll('[data-action="open-dish-action"]').forEach(el => {
        el.addEventListener('click', e => {
          e.stopPropagation();
          this.openDishActionModal(el.dataset.date, el.dataset.mt, el.dataset.field);
=======
      card.querySelectorAll('[data-action="open-dish"]').forEach(el => {
        el.addEventListener('click', e => {
          e.stopPropagation();
          const dish = this.getDish(el.dataset.id);
          if (!dish) return;
          const url = dish.recipeUrl || `https://www.google.com/search?q=レシピ+${encodeURIComponent(dish.name)}`;
          window.open(url, '_blank');
>>>>>>> f7a83d2d861a1e53b3290c0727ec894bf3c42a17
        });
      });

      container.appendChild(card);
    });
  },

  // meal オブジェクトと field から表示用情報を返す
  getMealEntry(meal, field) {
    const custom = (meal && meal[field + 'Custom']) || null;
    const dish   = meal ? this.getDish(meal[field]) : null;
    if (custom) return { name: custom, dish: null, isCustom: true };
    if (dish)   return { name: dish.name, dish, isCustom: false };
    return { name: null, dish: null, isCustom: false };
  },

  dishRow(label, meal, field, mt, dateKey) {
    const { name, isCustom } = this.getMealEntry(meal, field);
    const nameClass = name ? (isCustom ? 'custom-dish' : '') : 'empty';
    return `
      <div class="dish-row">
        <span class="dish-row-label">${label}</span>
<<<<<<< HEAD
        <span class="dish-row-name ${nameClass}"
          data-action="open-dish-action"
          data-date="${dateKey}" data-mt="${mt}" data-field="${field}"
        >${name || '未設定'}</span>
        <div class="dish-row-actions">
          <button class="icon-btn icon-btn-sm" data-action="dice-dish"
            data-mt="${mt}" data-field="${field}" title="ランダム変更" style="font-size:14px;">🎲</button>
=======
        <span class="dish-row-name ${dish ? '' : 'empty'}"
          ${dish ? `data-action="open-dish" data-id="${dish.id}"` : ''}
        >${dish ? dish.name : '未設定'}</span>
        <div class="dish-row-actions">
          <button class="icon-btn icon-btn-sm" data-action="dice-dish" data-mt="${mt}" data-field="${field}" title="ランダム変更" style="font-size:14px;">🎲</button>
>>>>>>> f7a83d2d861a1e53b3290c0727ec894bf3c42a17
        </div>
      </div>`;
  },

  // ============================================================
  // 献立DBビュー
  // ============================================================
  renderDbView() {
<<<<<<< HEAD
    const type     = this.state.activeDbType;
    const list     = document.getElementById('dish-list');
    const q        = this.normalize(this.state.dbSearchQuery);
    const mtFilter = this.state.dbMealTimeFilter || 'all';
=======
    const type  = this.state.activeDbType;
    const list  = document.getElementById('dish-list');
    const dishes = this.state.dishes.filter(d => d.type === type);
>>>>>>> f7a83d2d861a1e53b3290c0727ec894bf3c42a17

    // タブカウント更新
    document.querySelectorAll('.db-tab').forEach(tab => {
      const t = tab.dataset.type;
      const count = this.state.dishes.filter(d => d.type === t).length;
      tab.textContent = `${t === 'main' ? '主菜' : '副菜'}（${count}）`;
      tab.classList.toggle('active', t === type);
    });

<<<<<<< HEAD
    // 食事時間帯フィルターボタンのアクティブ状態
    document.querySelectorAll('.db-mealtime-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mt === mtFilter);
    });

    let dishes = this.state.dishes.filter(d => d.type === type);

    // 食事時間帯フィルター（mealTime が 'any' のものは常に表示）
    if (mtFilter !== 'all') {
      dishes = dishes.filter(d => {
        const mt = d.mealTime || 'any';
        return mt === 'any' || mt === mtFilter;
      });
    }

    if (q) {
      dishes = dishes.filter(d => this.normalize(d.name).includes(q));
    }

=======
>>>>>>> f7a83d2d861a1e53b3290c0727ec894bf3c42a17
    list.innerHTML = '';
    if (dishes.length === 0) {
      list.innerHTML = '<p style="text-align:center;color:#aaa;padding:32px;">献立がありません</p>';
      return;
    }

    dishes.forEach(dish => {
      const card = document.createElement('div');
      card.className = 'dish-card';
      const badgeClass = CATEGORY_BADGE[dish.category] || 'badge-other';
      const hasMemo = dish.memo && dish.memo.trim();

      card.innerHTML = `
        <div class="dish-card-info">
          <div class="dish-card-name">${dish.name}</div>
          <div class="dish-card-meta">
            <span class="badge ${badgeClass}">${dish.category}</span>
            ${dish.recipeUrl ? '<span class="badge badge-url">レシピあり</span>' : ''}
          </div>
          ${hasMemo ? `<div style="font-size:11px;color:#888;margin-top:3px;">${dish.memo}</div>` : ''}
        </div>
        <div class="dish-card-actions">
          <button class="icon-btn icon-btn-sm" data-action="edit-dish" data-id="${dish.id}" title="編集">✏️</button>
          <button class="icon-btn icon-btn-sm" data-action="delete-dish" data-id="${dish.id}" title="削除">🗑️</button>
        </div>`;

      card.querySelector('[data-action="edit-dish"]').addEventListener('click', () => this.openDishModal(dish));
      card.querySelector('[data-action="delete-dish"]').addEventListener('click', () => {
        this.confirm(`「${dish.name}」を削除しますか？`, async () => {
          await this.deleteDish(dish.id);
          this.renderDbView();
          this.showSnack('削除しました');
        });
      });

      list.appendChild(card);
    });
  },

  // ============================================================
  // 献立追加・編集モーダル
  // ============================================================
  openDishModal(dish) {
    document.getElementById('dish-modal-title').textContent = dish ? '献立を編集' : '献立を追加';
    document.getElementById('dish-edit-id').value    = dish ? dish.id   : '';
    document.getElementById('dish-name').value       = dish ? dish.name : '';
    document.getElementById('dish-type').value       = dish ? dish.type : 'main';
    document.getElementById('dish-category').value   = dish ? dish.category : '和食';
    document.getElementById('dish-recipe-url').value = dish && dish.recipeUrl ? dish.recipeUrl : '';
    document.getElementById('dish-memo').value       = dish ? (dish.memo || '') : '';

    // 食材チェック
    const grid = document.getElementById('ingredient-check-grid');
    grid.innerHTML = '';
    const selected = dish ? (dish.ingredients || []) : [];
    INGREDIENT_TAGS.forEach(tag => {
      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'ingredient-check' + (selected.includes(tag.id) ? ' checked' : '');
      btn.textContent = tag.label;
      btn.dataset.id  = tag.id;
      btn.addEventListener('click', () => btn.classList.toggle('checked'));
      grid.appendChild(btn);
    });

    this.showModal('dish-modal');
  },

  async submitDishForm(e) {
    e.preventDefault();
    const id   = document.getElementById('dish-edit-id').value || null;
    const name = document.getElementById('dish-name').value.trim();
    if (!name) return;

    const ingredients = Array.from(
      document.querySelectorAll('#ingredient-check-grid .ingredient-check.checked')
    ).map(b => b.dataset.id);

<<<<<<< HEAD
    this.showOverlay(true);
    try {
      // 画像処理
      const imageFile       = document.getElementById('dish-image-input').files[0];
      const currentImageUrl = document.getElementById('dish-image-url-current').value || null;
      const removeImage     = document.getElementById('btn-remove-image').dataset.remove === 'true';
      let imageUrl = currentImageUrl;

      const dishId = id || this.generateId();

      if (removeImage) {
        await this.deleteDishImage(currentImageUrl);
        imageUrl = null;
      } else if (imageFile) {
        if (currentImageUrl) await this.deleteDishImage(currentImageUrl);
        imageUrl = await this.uploadDishImage(imageFile, dishId);
      }

      const data = {
        name,
        type:       document.getElementById('dish-type').value,
        mealTime:   document.getElementById('dish-meal-time').value,
        category:   document.getElementById('dish-category').value,
        ingredients,
        recipeUrl:  document.getElementById('dish-recipe-url').value.trim() || null,
        recipeText: document.getElementById('dish-recipe-text').value.trim(),
        imageUrl,
        memo:       document.getElementById('dish-memo').value.trim(),
      };

      await this.saveDish(data, id ? id : dishId, !id);
      this.hideModal('dish-modal');

      // 献立選択モーダルから新規追加した場合 → その料理を自動選択して日別詳細へ
      if (this.state.addFromSelectModal && this.state.dishSelectContext) {
        this.state.addFromSelectModal = false;
        await this.selectDishFromModal(dishId);
      // 日別詳細から開いた場合は日別詳細を再描画して戻る
      } else if (this.state.editReturnToDailyView && this.state.selectedDate) {
        this.state.editReturnToDailyView = false;
        this.renderDailyView(this.state.selectedDate);
        this.showSnack('更新しました');
      } else {
        this.renderDbView();
        this.showSnack(id ? '更新しました' : '追加しました');
      }
    } catch (err) {
      alert('保存に失敗しました: ' + err.message);
    } finally {
      this.showOverlay(false);
    }
  },

  // ============================================================
  // 献立アクションモーダル（日別詳細で献立名タップ）
  // ============================================================
  openDishActionModal(dateKey, mealType, field) {
    const meal   = (this.state.mealPlan[dateKey] || {})[mealType] || {};
    const { name, dish } = this.getMealEntry(meal, field);

    this.state.dishActionContext = { dateKey, mealType, field };

    document.getElementById('dish-action-dish-name').textContent = name || '未設定';

    // レシピ確認：DBのdishにレシピ内容がある場合のみ
    const hasRecipe = dish && (dish.recipeUrl || dish.recipeText || dish.imageUrl);
    document.getElementById('btn-dish-action-recipe').classList.toggle('hidden', !hasRecipe);

    // DB編集：DBのdishがある場合のみ
    document.getElementById('btn-dish-action-edit').classList.toggle('hidden', !dish);

    // Web検索：名前がある場合のみ
    document.getElementById('btn-dish-action-websearch').classList.toggle('hidden', !name);

    // 手動入力フォームを閉じてボタン列を表示
    document.getElementById('dish-action-btns').classList.remove('hidden');
    document.getElementById('dish-action-custom-wrap').classList.add('hidden');

    // 現在のカスタム名があれば入力欄に反映
    const custom = meal[field + 'Custom'] || '';
    document.getElementById('dish-action-custom-input').value = custom;

    this.showModal('dish-action-modal');
  },

  // ============================================================
  // 献立選択モーダル（日別詳細からDBを選ぶ）
  // ============================================================
  openDishSelectModal(dateKey, mealType, field) {
    const dishType = field === 'main' ? 'main' : 'side';
    this.state.dishSelectContext = { dateKey, mealType, field, dishType };

    const titleLabel = { main: '主菜', side1: '副菜1', side2: '副菜2' };
    document.getElementById('dish-select-title').textContent =
      `${titleLabel[field] || '献立'}を選択`;
    document.getElementById('dish-select-search').value = '';

    this.renderDishSelectList('');
    this.showModal('dish-select-modal');

    // キーボード表示時にシートの高さを visualViewport に合わせて調整
    const sheet = document.querySelector('.dish-select-sheet');
    const onVpResize = () => {
      if (!window.visualViewport) return;
      const vh = window.visualViewport.height;
      sheet.style.maxHeight = Math.min(vh * 0.88, vh - 60) + 'px';
=======
    const data = {
      name,
      type:       document.getElementById('dish-type').value,
      category:   document.getElementById('dish-category').value,
      ingredients,
      recipeUrl:  document.getElementById('dish-recipe-url').value.trim() || null,
      memo:       document.getElementById('dish-memo').value.trim(),
>>>>>>> f7a83d2d861a1e53b3290c0727ec894bf3c42a17
    };

<<<<<<< HEAD
  renderDishSelectList(query) {
    const ctx = this.state.dishSelectContext;
    if (!ctx) return;

    const list = document.getElementById('dish-select-list');
    const q = this.normalize(query);

    let dishes = this.state.dishes.filter(d => d.type === ctx.dishType);
    if (q) {
      dishes = dishes.filter(d => this.normalize(d.name).includes(q));
    }

    // 現在選択中の dish を強調
    const curPlan = (this.state.mealPlan[ctx.dateKey] || {})[ctx.mealType] || {};
    const curId   = curPlan[ctx.field];

    list.innerHTML = '';
    if (dishes.length === 0) {
      list.innerHTML = '<p class="dish-select-empty">見つかりません</p>';
      return;
    }

    const MEAL_TIME_BADGE = { morning: '🌅朝', lunch_dinner: '🍱昼・夕', any: '' };
    dishes.forEach(dish => {
      const item = document.createElement('div');
      item.className = 'dish-select-item' + (dish.id === curId ? ' selected' : '');
      const badgeClass = CATEGORY_BADGE[dish.category] || 'badge-other';
      const mtBadge = MEAL_TIME_BADGE[dish.mealTime || 'any'];
      item.innerHTML = `
        <div class="dish-select-item-name">${dish.name}</div>
        <div class="dish-select-item-meta">
          <span class="badge ${badgeClass}">${dish.category || ''}</span>
          ${mtBadge ? `<span class="badge badge-meal-time">${mtBadge}</span>` : ''}
        </div>`;
      item.addEventListener('click', () => this.selectDishFromModal(dish.id));
      list.appendChild(item);
    });
  },

  async selectDishFromModal(dishId) {
    const ctx = this.state.dishSelectContext;
    if (!ctx) return;
    this.showOverlay(true);
    try {
      const cur     = (this.state.mealPlan[ctx.dateKey] || {})[ctx.mealType] || {};
      const updated = { ...cur, [ctx.field]: dishId, [ctx.field + 'Custom']: null };
      await this.saveMeal(ctx.dateKey, ctx.mealType, updated);
      this._closeDishSelectModal();
      this.showSnack('献立を変更しました');
=======
    this.showOverlay(true);
    try {
      await this.saveDish(data, id);
      this.hideModal('dish-modal');
      this.renderDbView();
      this.showSnack(id ? '更新しました' : '追加しました');
>>>>>>> f7a83d2d861a1e53b3290c0727ec894bf3c42a17
    } catch (e) {
      alert('保存に失敗しました: ' + e.message);
    } finally {
      this.showOverlay(false);
    }
  },

  // ============================================================
  // 設定ビュー
  // ============================================================
  renderSettingsView() {
    const user = this.state.user;
    document.getElementById('settings-user-email').textContent = user ? user.email : '';
  },

  // ============================================================
  // ナビゲーション
  // ============================================================
  showScreen(name) {
    ['loading-screen', 'auth-screen', 'household-screen', 'app'].forEach(id => {
      const el = document.getElementById(id);
      el.classList.toggle('hidden', id !== `${name === 'app' ? '' : name + '-'}screen` && !(name === 'app' && id === 'app'));
    });
    if (name === 'app') {
      document.getElementById('app').classList.remove('hidden');
      document.getElementById('loading-screen').classList.add('hidden');
      document.getElementById('auth-screen').classList.add('hidden');
      document.getElementById('household-screen').classList.add('hidden');
    } else {
      document.getElementById(`${name}-screen`).classList.remove('hidden');
    }
  },

  showView(name) {
    this.state.currentView = name;

    // ヘッダー：月次のみ表示
    const header = document.getElementById('app-header');
    header.classList.toggle('hidden', name !== 'monthly');

    // 各ビュー（お気に入り系サブビューは favorites に含める）
    const favSubViews = ['fav-detail-view', 'fav-form-view'];
    const baseViews = ['monthly-view', 'daily-view', 'favorites-view', 'db-view', 'settings-view'];
    baseViews.forEach(id => {
      document.getElementById(id).classList.toggle('hidden', id !== `${name}-view`);
    });
    if (name !== 'favorites') {
      favSubViews.forEach(id => document.getElementById(id).classList.add('hidden'));
    }

    // ボトムナビのアクティブ状態
    document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
      const v = btn.dataset.view;
      const isFavActive = name === 'favorites' && v === 'favorites';
      btn.classList.toggle('active',
        v === name ||
        (name === 'daily' && v === 'monthly') ||
        isFavActive
      );
    });

    // ビュー固有の描画
    if (name === 'db')        this.renderDbView();
    if (name === 'settings')  this.renderSettingsView();
    if (name === 'favorites') Favorites.openList();
  },

  // ============================================================
  // 月ナビゲーション
  // ============================================================
  changeMonth(delta) {
    let { year, month } = this.state;
    month += delta;
    if (month > 12) { year++; month = 1; }
    if (month < 1)  { year--; month = 12; }
    this.state.year  = year;
    this.state.month = month;
    this.state.mealPlan = {};
    this.subscribeToMealPlan();
    this.renderMonthlyView();
  },

  // ============================================================
  // モーダル
  // ============================================================
  showModal(id) { document.getElementById(id).classList.remove('hidden'); },
  hideModal(id) { document.getElementById(id).classList.add('hidden'); },

  confirm(message, callback) {
    this.state.confirmCallback = callback;
    document.getElementById('confirm-message').textContent = message;
    this.showModal('confirm-modal');
  },

  // ============================================================
  // UI ユーティリティ
  // ============================================================
  showOverlay(show) {
    document.getElementById('overlay-loading').classList.toggle('hidden', !show);
  },

  showSnack(msg) {
    const el = document.getElementById('snackbar');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2000);
  },

  // ============================================================
  // ヘルパー
  // ============================================================
  getDish(id) {
    return id ? this.state.dishes.find(d => d.id === id) || null : null;
  },

  // ひらがな・カタカナを統一（カタカナ→ひらがな）して小文字化
  normalize(s) {
    return (s || '').toLowerCase()
      .replace(/[\u30A1-\u30F6]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0x60));
  },

  pad(n)           { return String(n).padStart(2, '0'); },
  trunc(s, n)      { return s && s.length > n ? s.slice(0, n) + '…' : (s || ''); },
  dateToKey(date)  {
    return `${date.getFullYear()}-${this.pad(date.getMonth()+1)}-${this.pad(date.getDate())}`;
  },
  generateId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  },

  // ============================================================
  // イベントリスナー設定
  // ============================================================
  setupEventListeners() {
    // 認証
    document.getElementById('btn-google-login').addEventListener('click', () => this.signInWithGoogle());

    // 世帯
    document.getElementById('btn-create-household').addEventListener('click', () => this.createHousehold());
    document.getElementById('btn-join-household').addEventListener('click', () => {
      const code = document.getElementById('share-code-input').value.trim();
      this.joinHousehold(code);
    });

    // ヘッダー
    document.getElementById('btn-prev-month').addEventListener('click', () => this.changeMonth(-1));
    document.getElementById('btn-next-month').addEventListener('click', () => this.changeMonth(1));
    document.getElementById('btn-sort-toggle').addEventListener('click', () => {
      this.state.sortAsc = !this.state.sortAsc;
      document.getElementById('btn-sort-toggle').classList.toggle('sort-desc', !this.state.sortAsc);
      this.renderMonthlyView();
    });
    document.getElementById('btn-month-dice').addEventListener('click', () => this.generateMonth());

    // 日別詳細
    document.getElementById('btn-back-monthly').addEventListener('click', () => this.showView('monthly'));
    document.getElementById('btn-day-dice').addEventListener('click', async () => {
      if (this.state.selectedDate) {
        await this.generateDay(this.state.selectedDate, this.state.ingredientFilter);
      }
    });

    // DBビュー
    document.getElementById('btn-add-dish').addEventListener('click', () => this.openDishModal(null));
    document.querySelectorAll('.db-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.state.activeDbType = tab.dataset.type;
        this.renderDbView();
      });
    });
<<<<<<< HEAD
    // DB検索
    document.getElementById('db-search-input').addEventListener('input', e => {
      this.state.dbSearchQuery = e.target.value;
      this.renderDbView();
    });

    // DB 食事時間帯フィルター
    document.querySelectorAll('.db-mealtime-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.state.dbMealTimeFilter = btn.dataset.mt;
        this.renderDbView();
      });
    });

    // 献立アクションモーダル
    document.getElementById('dish-action-modal-overlay').addEventListener('click', () => {
      this.hideModal('dish-action-modal');
    });
    document.getElementById('btn-dish-action-close').addEventListener('click', () => {
      this.hideModal('dish-action-modal');
    });
    document.getElementById('btn-dish-action-recipe').addEventListener('click', () => {
      const ctx  = this.state.dishActionContext;
      const meal = (this.state.mealPlan[ctx.dateKey] || {})[ctx.mealType] || {};
      const { dish } = this.getMealEntry(meal, ctx.field);
      if (!dish) return;
      this.hideModal('dish-action-modal');
      this.openRecipeModal(dish);
    });
    document.getElementById('btn-dish-action-select').addEventListener('click', () => {
      const ctx = this.state.dishActionContext;
      this.hideModal('dish-action-modal');
      this.openDishSelectModal(ctx.dateKey, ctx.mealType, ctx.field);
    });
    document.getElementById('btn-dish-action-edit').addEventListener('click', () => {
      const ctx  = this.state.dishActionContext;
      const meal = (this.state.mealPlan[ctx.dateKey] || {})[ctx.mealType] || {};
      const { dish } = this.getMealEntry(meal, ctx.field);
      if (!dish) return;
      this.hideModal('dish-action-modal');
      this.state.editReturnToDailyView = true;
      this.openDishModal(dish);
    });
    document.getElementById('btn-dish-action-websearch').addEventListener('click', () => {
      const ctx  = this.state.dishActionContext;
      const meal = (this.state.mealPlan[ctx.dateKey] || {})[ctx.mealType] || {};
      const { name } = this.getMealEntry(meal, ctx.field);
      if (name) window.open(`https://www.google.com/search?q=レシピ+${encodeURIComponent(name)}`, '_blank');
    });
    // 手動入力ボタン → フォームを表示
    document.getElementById('btn-dish-action-custom').addEventListener('click', () => {
      document.getElementById('dish-action-btns').classList.add('hidden');
      document.getElementById('dish-action-custom-wrap').classList.remove('hidden');
      document.getElementById('dish-action-custom-input').focus();
    });
    // 手動入力：戻る
    document.getElementById('btn-dish-action-custom-back').addEventListener('click', () => {
      document.getElementById('dish-action-custom-wrap').classList.add('hidden');
      document.getElementById('dish-action-btns').classList.remove('hidden');
    });
    // 手動入力：決定
    document.getElementById('btn-dish-action-custom-save').addEventListener('click', async () => {
      const ctx = this.state.dishActionContext;
      const val = document.getElementById('dish-action-custom-input').value.trim();
      if (!val) return;
      this.showOverlay(true);
      try {
        const cur     = (this.state.mealPlan[ctx.dateKey] || {})[ctx.mealType] || {};
        const updated = { ...cur, [ctx.field]: null, [ctx.field + 'Custom']: val };
        await this.saveMeal(ctx.dateKey, ctx.mealType, updated);
        this.hideModal('dish-action-modal');
        this.showSnack('手動入力しました');
      } catch (e) {
        alert('保存に失敗しました: ' + e.message);
      } finally {
        this.showOverlay(false);
      }
    });

    // 献立選択モーダル
    document.getElementById('dish-select-modal-overlay').addEventListener('click', () => {
      this.state.addFromSelectModal = false;
      this._closeDishSelectModal();
    });
    document.getElementById('dish-select-search').addEventListener('input', e => {
      this.renderDishSelectList(e.target.value);
    });
    document.getElementById('btn-dish-select-add').addEventListener('click', () => {
      const ctx = this.state.dishSelectContext;
      if (!ctx) return;
      this.state.addFromSelectModal = true;
      this._closeDishSelectModal();
      this.openDishModal(null);
      // 種類・食事時間帯をコンテキストに合わせてプリセット
      document.getElementById('dish-type').value = ctx.dishType;
      if (ctx.mealType === 'breakfast') {
        document.getElementById('dish-meal-time').value = 'morning';
      }
    });
=======
>>>>>>> f7a83d2d861a1e53b3290c0727ec894bf3c42a17
    document.getElementById('dish-form').addEventListener('submit', e => this.submitDishForm(e));
    document.getElementById('btn-cancel-dish').addEventListener('click', () => this.hideModal('dish-modal'));
    document.getElementById('dish-modal-overlay').addEventListener('click', () => this.hideModal('dish-modal'));

    // 共有コードモーダル
    document.getElementById('row-share-code').addEventListener('click', () => {
      document.getElementById('share-code-display').textContent = this.state.shareCode || '---';
      this.showModal('share-modal');
    });
    document.getElementById('btn-copy-share-code').addEventListener('click', () => {
      navigator.clipboard.writeText(this.state.shareCode || '').then(() => this.showSnack('コピーしました'));
    });
    document.getElementById('btn-close-share-modal').addEventListener('click', () => this.hideModal('share-modal'));
    document.getElementById('share-modal-overlay').addEventListener('click', () => this.hideModal('share-modal'));

    // 確認モーダル
    document.getElementById('btn-confirm-ok').addEventListener('click', () => {
      this.hideModal('confirm-modal');
      if (this.state.confirmCallback) this.state.confirmCallback();
      this.state.confirmCallback = null;
    });
    document.getElementById('btn-confirm-cancel').addEventListener('click', () => {
      this.hideModal('confirm-modal');
      this.state.confirmCallback = null;
    });
    document.getElementById('confirm-modal-overlay').addEventListener('click', () => {
      this.hideModal('confirm-modal');
      this.state.confirmCallback = null;
    });

    // ログアウト
    document.getElementById('row-sign-out').addEventListener('click', () => this.signOut());

    // ボトムナビ
    document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view) this.showView(view);
      });
    });
  },
};

// 起動
document.addEventListener('DOMContentLoaded', () => App.init());
