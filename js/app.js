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
  },
  db:      null,
  auth:    null,
  storage: null,

  // ============================================================
  // 初期化
  // ============================================================
  async init() {
    try {
      firebase.initializeApp(window.firebaseConfig);
      this.db      = firebase.firestore();
      this.auth    = firebase.auth();
      this.storage = firebase.storage();
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

  // メール/パスワード認証
  async signInWithEmail(email, password) {
    try {
      await this.auth.signInWithEmailAndPassword(email, password);
    } catch (e) {
      return this.authErrorMessage(e.code);
    }
    return null;
  },

  async registerWithEmail(email, password) {
    try {
      await this.auth.createUserWithEmailAndPassword(email, password);
    } catch (e) {
      return this.authErrorMessage(e.code);
    }
    return null;
  },

  authErrorMessage(code) {
    const map = {
      'auth/invalid-email':          'メールアドレスの形式が正しくありません',
      'auth/user-not-found':         'メールアドレスまたはパスワードが違います',
      'auth/wrong-password':         'メールアドレスまたはパスワードが違います',
      'auth/invalid-credential':     'メールアドレスまたはパスワードが違います',
      'auth/email-already-in-use':   'このメールアドレスはすでに登録されています',
      'auth/weak-password':          'パスワードは6文字以上にしてください',
      'auth/too-many-requests':      'しばらく時間をおいてから再試行してください',
    };
    return map[code] || 'エラーが発生しました: ' + code;
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
  // isNew=true のとき指定 id で新規作成（画像アップロード時に id が先に決まるため）
  async saveDish(data, id, isNew = false) {
    const colRef = this.db.collection('households').doc(this.state.householdId).collection('dishes');
    if (!isNew && !id) throw new Error('id が必要です');
    if (isNew) {
      const doc = { ...data, id, createdAt: firebase.firestore.FieldValue.serverTimestamp() };
      await colRef.doc(id).set(doc);
      this.state.dishes.push(doc);
      this.state.dishes.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    } else {
      await colRef.doc(id).update(data);
      const idx = this.state.dishes.findIndex(d => d.id === id);
      if (idx >= 0) this.state.dishes[idx] = { ...this.state.dishes[idx], ...data };
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

  // mealType: 'breakfast' | 'lunch' | 'dinner'
  pickDish(type, excludeIds, filter, mealType) {
    const mealTimeOk = d => {
      const mt = d.mealTime || 'any';
      if (mt === 'any') return true;
      if (mealType === 'breakfast') return mt === 'morning';
      return mt === 'lunch_dinner'; // lunch or dinner
    };

    let pool = this.state.dishes.filter(d =>
      d.type === type && !excludeIds.has(d.id) && mealTimeOk(d)
    );
    if (filter && filter.length > 0) {
      const filtered = pool.filter(d => filter.some(f => (d.ingredients || []).includes(f)));
      if (filtered.length > 0) pool = filtered;
    }
    // フォールバック：mealTime 条件を外す
    if (pool.length === 0) {
      pool = this.state.dishes.filter(d => d.type === type && !excludeIds.has(d.id));
    }
    if (pool.length === 0) {
      pool = this.state.dishes.filter(d => d.type === type);
    }
    return pool[Math.floor(Math.random() * pool.length)] || null;
  },

  // 1食分（主菜・副菜1・副菜2）をランダム生成
  generateOneMeal(dateKey, excludeMain, excludeSide, filter, mealType) {
    const main  = this.pickDish('main', excludeMain, filter, mealType);
    const used  = new Set(excludeSide);
    const side1 = this.pickDish('side', used, [], mealType);
    if (side1) used.add(side1.id);
    const side2 = this.pickDish('side', used, [], mealType);
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
        const m = this.generateOneMeal(dateKey, exMain, exSide, filter, mt);
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

  // 1食分だけ置き換え
  async generateOneMealAndSave(dateKey, mealType, filter) {
    const exMain = this.getRecentIds(dateKey, 5, 'main');
    const exSide = this.getRecentIds(dateKey, 3, 'side');
    const m = this.generateOneMeal(dateKey, exMain, exSide, filter, mealType);
    await this.saveMeal(dateKey, mealType, m);
    this.showSnack('献立を変更しました');
  },

  // 1品だけ置き換え
  async generateOneDishAndSave(dateKey, mealType, dishField, filter) {
    const cur   = (this.state.mealPlan[dateKey] || {})[mealType] || {};
    const exIds = new Set([cur.main, cur.side1, cur.side2].filter(Boolean));
    const type  = dishField === 'main' ? 'main' : 'side';
    const dish  = this.pickDish(type, exIds, type === 'main' ? filter : [], mealType);
    if (!dish) return;
    const updated = { ...cur, [dishField]: dish.id };
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
            const m = this.generateOneMeal(dateKey, exMain, exSide, [], mt);
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
  // Firebase Storage：画像アップロード／削除
  // ============================================================
  async uploadDishImage(file, dishId) {
    const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
    const path = `households/${this.state.householdId}/dishes/${dishId}_${Date.now()}.${ext}`;
    const ref  = this.storage.ref(path);
    await ref.put(file, { contentType: file.type });
    return await ref.getDownloadURL();
  },

  async deleteDishImage(imageUrl) {
    if (!imageUrl) return;
    try { await this.storage.refFromURL(imageUrl).delete(); } catch (e) { /* 既に削除済みなら無視 */ }
  },

  // ============================================================
  // 献立DB 移行：既存データに mealTime を付与
  // ============================================================
  async migrateDishes() {
    const targets = this.state.dishes.filter(d => !d.mealTime);
    if (targets.length === 0) { this.showSnack('すでに更新済みです'); return; }

    this.showOverlay(true);
    try {
      const colRef = this.db.collection('households').doc(this.state.householdId).collection('dishes');
      const batch  = this.db.batch();
      targets.forEach(d => {
        const mt = MEAL_TIME_MAP[d.name] || 'any';
        batch.update(colRef.doc(d.id), { mealTime: mt });
        d.mealTime = mt;
      });
      await batch.commit();
      this.showSnack(`${targets.length}件の献立を更新しました`);
    } catch (e) {
      alert('更新に失敗しました: ' + e.message);
    } finally {
      this.showOverlay(false);
    }
  },

  // ============================================================
  // 献立DB CSV エクスポート
  // ============================================================
  exportDishesCSV() {
    const MEAL_TIME_LABEL = { morning: '朝向け', lunch_dinner: '昼・夕向け', any: 'いつでも' };
    const headers = ['料理名','種類','食事時間帯','カテゴリ','食材タグ','レシピURL','レシピ本文','メモ'];
    const rows = this.state.dishes.map(d => [
      d.name,
      d.type === 'main' ? '主菜' : '副菜',
      MEAL_TIME_LABEL[d.mealTime || 'any'],
      d.category || '',
      (d.ingredients || []).join('|'),
      d.recipeUrl  || '',
      (d.recipeText || '').replace(/\r?\n/g, '\\n'),
      d.memo       || '',
    ]);
    const escape = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv    = [headers, ...rows].map(r => r.map(escape).join(',')).join('\r\n');
    const blob   = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href = url;
    a.download = `献立DB_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // ============================================================
  // レシピ詳細モーダル
  // ============================================================
  openRecipeModal(dish) {
    document.getElementById('recipe-modal-title').textContent = dish.name;

    const img = document.getElementById('recipe-modal-image');
    if (dish.imageUrl) {
      img.src = dish.imageUrl;
      img.classList.remove('hidden');
    } else {
      img.classList.add('hidden');
    }

    const textEl = document.getElementById('recipe-modal-text');
    if (dish.recipeText && dish.recipeText.trim()) {
      textEl.textContent = dish.recipeText;
      textEl.classList.remove('hidden');
    } else {
      textEl.textContent = '';
      textEl.classList.add('hidden');
    }

    const btnUrl    = document.getElementById('btn-recipe-url');
    const btnSearch = document.getElementById('btn-recipe-search');
    if (dish.recipeUrl) {
      btnUrl.classList.remove('hidden');
      btnUrl.onclick = () => window.open(dish.recipeUrl, '_blank');
      btnSearch.classList.add('hidden');
    } else {
      btnUrl.classList.add('hidden');
      btnSearch.classList.remove('hidden');
      btnSearch.onclick = () => window.open(`https://www.google.com/search?q=レシピ+${encodeURIComponent(dish.name)}`, '_blank');
    }

    this.showModal('recipe-modal');
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
          const main  = plan ? this.getDish(plan.main)  : null;
          const side1 = plan ? this.getDish(plan.side1) : null;
          const side2 = plan ? this.getDish(plan.side2) : null;
          return `
            <td class="meal-cell">
              <div class="meal-cell-inner">
                <div class="dish-tag main-tag">${main  ? this.trunc(main.name,  10) : '未設定'}</div>
                <div class="dish-tag">${side1 ? this.trunc(side1.name, 10) : ''}</div>
                <div class="dish-tag">${side2 ? this.trunc(side2.name, 10) : ''}</div>
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
          ${this.dishRow('主菜', meal.main,  mt, 'main',  dateKey)}
          ${this.dishRow('副菜1', meal.side1, mt, 'side1', dateKey)}
          ${this.dishRow('副菜2', meal.side2, mt, 'side2', dateKey)}
        </div>`;

      // 食事全体サイコロ
      card.querySelector('[data-action="dice-meal"]').addEventListener('click', async e => {
        e.stopPropagation();
        await this.generateOneMealAndSave(dateKey, mt, this.state.ingredientFilter);
      });

      // 各品のサイコロ・名前クリック
      card.querySelectorAll('[data-action="dice-dish"]').forEach(btn => {
        btn.addEventListener('click', async e => {
          e.stopPropagation();
          await this.generateOneDishAndSave(dateKey, btn.dataset.mt, btn.dataset.field, this.state.ingredientFilter);
        });
      });
      card.querySelectorAll('[data-action="open-recipe"]').forEach(el => {
        el.addEventListener('click', e => {
          e.stopPropagation();
          const dish = this.getDish(el.dataset.id);
          if (!dish) return;
          this.openRecipeModal(dish);
        });
      });

      container.appendChild(card);
    });
  },

  dishRow(label, dishId, mt, field, dateKey) {
    const dish = dishId ? this.getDish(dishId) : null;
    return `
      <div class="dish-row">
        <span class="dish-row-label">${label}</span>
        <span class="dish-row-name ${dish ? '' : 'empty'}"
          ${dish ? `data-action="open-recipe" data-id="${dish.id}"` : ''}
        >${dish ? dish.name : '未設定'}</span>
        <div class="dish-row-actions">
          <button class="icon-btn icon-btn-sm" data-action="dice-dish" data-mt="${mt}" data-field="${field}" title="ランダム変更" style="font-size:14px;">🎲</button>
        </div>
      </div>`;
  },

  // ============================================================
  // 献立DBビュー
  // ============================================================
  renderDbView() {
    const type  = this.state.activeDbType;
    const list  = document.getElementById('dish-list');
    const dishes = this.state.dishes.filter(d => d.type === type);

    // タブカウント更新
    document.querySelectorAll('.db-tab').forEach(tab => {
      const t = tab.dataset.type;
      const count = this.state.dishes.filter(d => d.type === t).length;
      tab.textContent = `${t === 'main' ? '主菜' : '副菜'}（${count}）`;
      tab.classList.toggle('active', t === type);
    });

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

      const MEAL_TIME_BADGE = { morning: '🌅朝', lunch_dinner: '🍱昼・夕', any: '' };
      const mealTimeBadge  = MEAL_TIME_BADGE[dish.mealTime || 'any'];
      card.innerHTML = `
        ${dish.imageUrl ? `<img class="dish-card-thumb" src="${dish.imageUrl}" alt="${dish.name}">` : ''}
        <div class="dish-card-info">
          <div class="dish-card-name">${dish.name}</div>
          <div class="dish-card-meta">
            <span class="badge ${badgeClass}">${dish.category}</span>
            ${mealTimeBadge ? `<span class="badge badge-meal-time">${mealTimeBadge}</span>` : ''}
            ${dish.recipeUrl  ? '<span class="badge badge-url">URLあり</span>'  : ''}
            ${dish.recipeText ? '<span class="badge badge-url">レシピあり</span>' : ''}
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
    document.getElementById('dish-modal-title').textContent  = dish ? '献立を編集' : '献立を追加';
    document.getElementById('dish-edit-id').value            = dish ? dish.id   : '';
    document.getElementById('dish-name').value               = dish ? dish.name : '';
    document.getElementById('dish-type').value               = dish ? dish.type : 'main';
    document.getElementById('dish-meal-time').value          = dish ? (dish.mealTime || 'any') : 'any';
    document.getElementById('dish-category').value           = dish ? dish.category : '和食';
    document.getElementById('dish-recipe-url').value         = dish && dish.recipeUrl  ? dish.recipeUrl  : '';
    document.getElementById('dish-recipe-text').value        = dish && dish.recipeText ? dish.recipeText : '';
    document.getElementById('dish-memo').value               = dish ? (dish.memo || '') : '';
    document.getElementById('dish-image-url-current').value  = dish && dish.imageUrl   ? dish.imageUrl   : '';

    // 画像プレビューリセット
    const preview   = document.getElementById('dish-image-preview');
    const removeBtn = document.getElementById('btn-remove-image');
    const hint      = document.getElementById('image-upload-hint');
    document.getElementById('dish-image-input').value = '';
    if (dish && dish.imageUrl) {
      preview.src = dish.imageUrl;
      preview.classList.remove('hidden');
      removeBtn.classList.remove('hidden');
      hint.textContent = '📷 写真を変更';
    } else {
      preview.classList.add('hidden');
      removeBtn.classList.add('hidden');
      hint.textContent = '📷 写真を選択';
    }

    // 食材チェック
    const grid = document.getElementById('ingredient-check-grid');
    grid.innerHTML = '';
    const selected = dish ? (dish.ingredients || []) : [];
    INGREDIENT_TAGS.forEach(tag => {
      const btn = document.createElement('button');
      btn.type        = 'button';
      btn.className   = 'ingredient-check' + (selected.includes(tag.id) ? ' checked' : '');
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
      this.renderDbView();
      this.showSnack(id ? '更新しました' : '追加しました');
    } catch (err) {
      alert('保存に失敗しました: ' + err.message);
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

    // 各ビュー
    ['monthly-view', 'daily-view', 'db-view', 'settings-view'].forEach(id => {
      document.getElementById(id).classList.toggle('hidden', id !== `${name}-view`);
    });

    // ボトムナビのアクティブ状態
    document.querySelectorAll('#bottom-nav .nav-btn').forEach(btn => {
      const v = btn.dataset.view;
      btn.classList.toggle('active', v === name || (name === 'daily' && v === 'monthly'));
    });

    // ビュー固有の描画
    if (name === 'db')       this.renderDbView();
    if (name === 'settings') this.renderSettingsView();
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
    // 認証タブ切り替え
    let authMode = 'login'; // 'login' | 'register'
    const tabLogin    = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const btnSubmit   = document.getElementById('btn-auth-submit');

    tabLogin.addEventListener('click', () => {
      authMode = 'login';
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      btnSubmit.textContent = 'ログイン';
      document.getElementById('auth-error').textContent = '';
    });
    tabRegister.addEventListener('click', () => {
      authMode = 'register';
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      btnSubmit.textContent = 'アカウントを作成';
      document.getElementById('auth-error').textContent = '';
    });

    // 認証フォーム送信
    document.getElementById('auth-form').addEventListener('submit', async e => {
      e.preventDefault();
      const email    = document.getElementById('auth-email').value.trim();
      const password = document.getElementById('auth-password').value;
      const errEl    = document.getElementById('auth-error');
      errEl.textContent = '';
      btnSubmit.disabled = true;

      const err = authMode === 'login'
        ? await this.signInWithEmail(email, password)
        : await this.registerWithEmail(email, password);

      if (err) {
        errEl.textContent = err;
        btnSubmit.disabled = false;
      }
    });

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
    document.getElementById('dish-form').addEventListener('submit', e => this.submitDishForm(e));
    document.getElementById('btn-cancel-dish').addEventListener('click', () => this.hideModal('dish-modal'));
    document.getElementById('dish-modal-overlay').addEventListener('click', () => this.hideModal('dish-modal'));

    // 画像選択プレビュー
    document.getElementById('dish-image-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const preview   = document.getElementById('dish-image-preview');
      const removeBtn = document.getElementById('btn-remove-image');
      const hint      = document.getElementById('image-upload-hint');
      preview.src = URL.createObjectURL(file);
      preview.classList.remove('hidden');
      removeBtn.classList.remove('hidden');
      removeBtn.dataset.remove = 'false';
      hint.textContent = '📷 写真を変更';
    });
    // 画像削除ボタン
    document.getElementById('btn-remove-image').addEventListener('click', () => {
      const preview   = document.getElementById('dish-image-preview');
      const removeBtn = document.getElementById('btn-remove-image');
      const hint      = document.getElementById('image-upload-hint');
      document.getElementById('dish-image-input').value = '';
      preview.classList.add('hidden');
      removeBtn.classList.add('hidden');
      removeBtn.dataset.remove = 'true';
      hint.textContent = '📷 写真を選択';
    });

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

    // レシピモーダル
    document.getElementById('recipe-modal-overlay').addEventListener('click', () => this.hideModal('recipe-modal'));
    document.getElementById('btn-close-recipe-modal').addEventListener('click', () => this.hideModal('recipe-modal'));

    // 設定：献立DB移行・CSVエクスポート
    document.getElementById('row-migrate-dishes').addEventListener('click', () => this.migrateDishes());
    document.getElementById('row-export-csv').addEventListener('click', () => this.exportDishesCSV());

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
