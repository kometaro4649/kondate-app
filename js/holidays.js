// 日本の祝日計算
const Holidays = {
  _cache: {},

  // N番目の曜日を取得（例：1月の第2月曜日）
  _getNthWeekday(year, month, weekday, n) {
    const d = new Date(year, month - 1, 1);
    let count = 0;
    while (d.getMonth() === month - 1) {
      if (d.getDay() === weekday) {
        count++;
        if (count === n) return d.getDate();
      }
      d.setDate(d.getDate() + 1);
    }
    return -1;
  },

  // 春分の日（近似計算）
  _springEquinox(year) {
    if (year <= 1979) return 21;
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  },

  // 秋分の日（近似計算）
  _autumnEquinox(year) {
    if (year <= 1979) return 23;
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  },

  _pad(n) { return String(n).padStart(2, '0'); },

  _getAll(year) {
    const H = {};
    const add = (m, d, name) => {
      if (d > 0) H[`${year}-${this._pad(m)}-${this._pad(d)}`] = name;
    };

    // 固定祝日
    add(1,  1,  '元日');
    add(2,  11, '建国記念の日');
    add(2,  23, '天皇誕生日');
    add(4,  29, '昭和の日');
    add(5,  3,  '憲法記念日');
    add(5,  4,  'みどりの日');
    add(5,  5,  'こどもの日');
    add(8,  11, '山の日');
    add(11, 3,  '文化の日');
    add(11, 23, '勤労感謝の日');

    // ハッピーマンデー
    add(1,  this._getNthWeekday(year, 1,  1, 2), '成人の日');
    add(7,  this._getNthWeekday(year, 7,  1, 3), '海の日');
    add(9,  this._getNthWeekday(year, 9,  1, 3), '敬老の日');
    add(10, this._getNthWeekday(year, 10, 1, 2), 'スポーツの日');

    // 春分・秋分
    add(3, this._springEquinox(year), '春分の日');
    add(9, this._autumnEquinox(year), '秋分の日');

    // 振替休日（日曜日の翌平日）
    const subs = {};
    Object.keys(H).forEach(key => {
      const d = new Date(key);
      if (d.getDay() === 0) {
        let sub = new Date(d);
        sub.setDate(sub.getDate() + 1);
        while (H[sub.toISOString().slice(0,10)] || subs[sub.toISOString().slice(0,10)]) {
          sub.setDate(sub.getDate() + 1);
        }
        subs[sub.toISOString().slice(0,10)] = '振替休日';
      }
    });

    // 国民の休日（祝日に挟まれた平日）
    const citizens = {};
    const allKeys = Object.keys({ ...H, ...subs }).sort();
    allKeys.forEach(key => {
      const d = new Date(key);
      const prev = new Date(d); prev.setDate(prev.getDate() - 1);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const prevKey = prev.toISOString().slice(0,10);
      const nextKey = next.toISOString().slice(0,10);
      const isHoliday = k => H[k] || subs[k];
      if (isHoliday(prevKey) && isHoliday(nextKey)) {
        if (!H[key] && !subs[key] && d.getDay() !== 0) {
          citizens[key] = '国民の休日';
        }
      }
    });

    return { ...H, ...subs, ...citizens };
  },

  // 祝日名を返す（祝日でなければ null）
  getName(year, month, day) {
    if (!this._cache[year]) this._cache[year] = this._getAll(year);
    const key = `${year}-${this._pad(month)}-${this._pad(day)}`;
    return this._cache[year][key] || null;
  }
};
