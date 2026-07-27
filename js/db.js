// db.js — Toda la persistencia vive en localStorage. Sin backend, sin red.
const DB_KEY = 'eventos_pwa_v1';

function normalizeName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
    .replace(/\s+/g, ' ')
    .trim();
}

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
    this._data.guests.forEach(g => { if (typeof g.llego !== 'boolean') g.llego = false; });
    this._data.tables.forEach(t => {
      if (t.capacidad === undefined) t.capacidad = null;
      if (t.etiqueta === undefined) t.etiqueta = '';
    });
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

  // Busca invitados existentes con el mismo nombre (normalizado). excludeId para ediciones.
  findDuplicates(nombre, excludeId) {
    const n = normalizeName(nombre);
    if (!n) return [];
    return this.guests.filter(g => g.id !== excludeId && normalizeName(g.nombre) === n);
  },

  addGuest(nombre, mesa, llego) {
    const g = {
      id: 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      nombre: nombre.trim(),
      mesa: (mesa || '').trim(),
      llego: !!llego
    };
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

  toggleCheckin(id) {
    const g = this.guests.find(x => x.id === id);
    if (!g) return;
    g.llego = !g.llego;
    this.save();
    return g.llego;
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
      this._data.tables.push({
        id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        name: n, capacidad: null, etiqueta: ''
      });
    }
  },

  addTable(name, capacidad, etiqueta) {
    const n = name.trim();
    if (!n) return null;
    const existing = this.tables.find(t => t.name.toLowerCase() === n.toLowerCase());
    if (existing) return existing;
    const t = {
      id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: n,
      capacidad: (capacidad || capacidad === 0) ? Number(capacidad) : null,
      etiqueta: (etiqueta || '').trim()
    };
    this.load().tables.push(t);
    this.save();
    return t;
  },

  updateTable(id, name, capacidad, etiqueta) {
    const t = this.tables.find(x => x.id === id);
    if (!t) return;
    const oldName = t.name;
    t.name = name.trim();
    t.capacidad = (capacidad || capacidad === 0) ? Number(capacidad) : null;
    t.etiqueta = (etiqueta || '').trim();
    // Si cambió el nombre, actualiza a los invitados que apuntaban al nombre viejo
    if (oldName.toLowerCase() !== t.name.toLowerCase()) {
      this.guests.forEach(g => {
        if (g.mesa.toLowerCase() === oldName.toLowerCase()) g.mesa = t.name;
      });
    }
    this.save();
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

  guestsInTable(tableName) {
    return this.guests.filter(g => g.mesa.toLowerCase() === tableName.toLowerCase());
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
