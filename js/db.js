// db.js — Toda la persistencia vive en localStorage. Sin backend, sin red.
const DB_KEY = 'eventos_pwa_v1';

const DB = {
  _data: null,

  load() {
    if (this._data) return this._data;
    try {
      const raw = localStorage.getItem(DB_KEY);
      this._data = raw ? JSON.parse(raw) : this._defaults();
    } catch (e) {
      console.error('Error leyendo datos locales, iniciando de cero.', e);
      this._data = this._defaults();
    }
    // Migración/relleno de campos faltantes
    if (!this._data.event) this._data.event = { name: 'Mi evento', date: '' };
    if (!Array.isArray(this._data.guests)) this._data.guests = [];
    if (!Array.isArray(this._data.tables)) this._data.tables = [];
    return this._data;
  },

  _defaults() {
    return { event: { name: 'Mi evento', date: '' }, guests: [], tables: [] };
  },

  save() {
    localStorage.setItem(DB_KEY, JSON.stringify(this._data));
  },

  get event() { return this.load().event; },
  get guests() { return this.load().guests; },
  get tables() { return this.load().tables; },

  saveEvent(name, date) {
    this.load().event = { name: name || 'Mi evento', date: date || '' };
    this.save();
  },

  addGuest(nombre, mesa) {
    const g = { id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), nombre: nombre.trim(), mesa: (mesa || '').trim() };
    this.load().guests.push(g);
    this._ensureTable(g.mesa);
    this.save();
    return g;
  },

  updateGuest(id, nombre, mesa) {
    const g = this.guests.find(x => x.id === id);
    if (!g) return;
    g.nombre = nombre.trim();
    g.mesa = (mesa || '').trim();
    this._ensureTable(g.mesa);
    this.save();
  },

  deleteGuest(id) {
    const arr = this.load().guests;
    const i = arr.findIndex(x => x.id === id);
    if (i > -1) arr.splice(i, 1);
    this.save();
  },

  moveGuest(id, mesa) {
    this.updateGuest(id, this.guests.find(x => x.id === id).nombre, mesa);
  },

  _ensureTable(name) {
    const n = (name || '').trim();
    if (!n) return;
    if (!this.load().tables.find(t => t.name.toLowerCase() === n.toLowerCase())) {
      this._data.tables.push({ id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name: n });
    }
  },

  addTable(name) {
    const n = name.trim();
    if (!n) return null;
    const existing = this.tables.find(t => t.name.toLowerCase() === n.toLowerCase());
    if (existing) return existing;
    const t = { id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7), name: n };
    this.load().tables.push(t);
    this.save();
    return t;
  },

  deleteTable(id) {
    const t = this.tables.find(x => x.id === id);
    if (!t) return;
    // Los invitados de esa mesa quedan sin mesa asignada
    this.guests.forEach(g => { if (g.mesa.toLowerCase() === t.name.toLowerCase()) g.mesa = ''; });
    const i = this.load().tables.findIndex(x => x.id === id);
    if (i > -1) this._data.tables.splice(i, 1);
    this.save();
  },

  // Importa un lote de {nombre, mesa}. Si replace=true, sustituye toda la lista.
  bulkImport(rows, replace) {
    if (replace) {
      this._data.guests = [];
      this._data.tables = [];
    }
    rows.forEach(r => {
      if (!r.nombre) return;
      this.addGuest(r.nombre, r.mesa || '');
    });
    this.save();
  },

  clearAll() {
    this._data = this._defaults();
    this.save();
  },

  exportBackup() {
    return JSON.stringify(this.load(), null, 2);
  }
};
