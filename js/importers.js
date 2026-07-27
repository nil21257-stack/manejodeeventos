// importers.js — Extrae texto/filas desde Excel, PDF o imagen (OCR), 100% en el dispositivo.
// normalizeName() vive en db.js y se usa aquí también para marcar duplicados en la vista previa.

const Importers = {

  // ---------- EXCEL / CSV ----------
  async parseExcel(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rows.length) return { rows: [], rawText: '' };

    // Detecta si la primera fila es encabezado buscando palabras clave
    const headerCandidates = rows[0].map(c => String(c).toLowerCase().trim());
    const nameCol = headerCandidates.findIndex(c => /nombre|invitad|guest|name/.test(c));
    const tableCol = headerCandidates.findIndex(c => /mesa|tabla|table/.test(c));

    let dataRows = rows;
    let nCol = nameCol, tCol = tableCol;
    if (nameCol > -1) {
      dataRows = rows.slice(1); // hay encabezado real
    } else {
      // sin encabezado reconocible: asumimos columna 0 = nombre, columna 1 = mesa
      nCol = 0; tCol = 1;
    }

    const out = [];
    dataRows.forEach(r => {
      const nombre = String(r[nCol] ?? '').trim();
      const mesa = tCol > -1 ? String(r[tCol] ?? '').trim() : '';
      if (nombre) out.push({ nombre, mesa });
    });

    const rawText = out.map(r => r.mesa ? `${r.nombre}, ${r.mesa}` : r.nombre).join('\n');
    return { rows: out, rawText };
  },

  // ---------- PDF ----------
  async parsePdf(file) {
    await this._ensurePdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      // Agrupa items por posición vertical (misma línea aprox.)
      const byY = {};
      content.items.forEach(item => {
        const y = Math.round(item.transform[5]);
        if (!byY[y]) byY[y] = [];
        byY[y].push(item.str);
      });
      const ys = Object.keys(byY).map(Number).sort((a, b) => b - a);
      ys.forEach(y => {
        const line = byY[y].join(' ').replace(/\s+/g, ' ').trim();
        if (line) lines.push(line);
      });
    }
    return { rawText: lines.join('\n') };
  },

  async _ensurePdfJs() {
    if (window.pdfjsLib) return;
    window.pdfjsLib = await import('./vendor/pdf.min.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.mjs';
  },

  // ---------- OCR (foto/escaneo) ----------
  async parseImage(file, onProgress) {
    if (!window.Tesseract) await this._loadScript('vendor/tesseract.min.js', false);
    const resized = await this._downscaleImage(file, 1800);
    const worker = await Tesseract.createWorker('spa', 1, {
      workerPath: 'vendor/worker.min.js',
      corePath: 'vendor/tesseract-core-simd-lstm.js',
      langPath: 'tessdata',
      gzip: true,
      logger: m => { if (onProgress) onProgress(m); }
    });
    try {
      const { data } = await worker.recognize(resized);
      return { rawText: data.text.trim() };
    } finally {
      await worker.terminate();
    }
  },

  // Reduce fotos de cámara (a menudo 12MP+) a un lado máximo razonable para leer texto.
  // Esto acelera el OCR drásticamente sin perder legibilidad del texto.
  _downscaleImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        if (scale >= 1) { resolve(file); return; } // ya es pequeña, no tocarla
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => resolve(blob || file), 'image/jpeg', 0.92);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); }; // si falla, seguimos con el original
      img.src = url;
    });
  },

  _loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = reject;
      document.head.appendChild(s);
    });
  },

  // ---------- Parser de texto libre -> filas {nombre, mesa} ----------
  // Acepta líneas como:
  //   "Ana Pérez, Mesa 3"      "Ana Pérez - Mesa 3"      "Ana Pérez\tMesa 3"
  //   "Mesa 3: Ana Pérez, Juan López"   (varios invitados por mesa)
  //   "Ana Pérez"  (sin mesa)
  parseFreeText(text) {
    const rows = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    lines.forEach(line => {
      // Formato "Mesa X: nombre1, nombre2, nombre3"
      let m = line.match(/^(mesa|tabla|table)\s*[:\-]?\s*(\S.*?)\s*[:\-]\s*(.+)$/i);
      if (m) {
        const mesa = `${m[1]} ${m[2]}`.replace(/\s+/g, ' ').trim();
        m[3].split(/,|;/).forEach(n => {
          const nombre = n.trim();
          if (nombre) rows.push({ nombre, mesa });
        });
        return;
      }

      // Formato "Nombre, Mesa" / "Nombre - Mesa" / "Nombre\tMesa" / "Nombre | Mesa"
      m = line.match(/^(.+?)\s*[,\t|]\s*((?:mesa|tabla|table)?\s*[\wñÑáéíóúÁÉÍÓÚ.\-]+)$/i);
      if (m && /mesa|tabla|table|^\d+$/i.test(m[2])) {
        rows.push({ nombre: m[1].trim(), mesa: m[2].trim() });
        return;
      }
      m = line.match(/^(.+?)\s+-\s+(.+)$/);
      if (m) {
        rows.push({ nombre: m[1].trim(), mesa: m[2].trim() });
        return;
      }

      // Sin mesa detectable: toda la línea es el nombre (si no es puro ruido)
      if (line.length > 1 && !/^(nombre|invitado|guest|name)s?$/i.test(line)) {
        rows.push({ nombre: line, mesa: '' });
      }
    });

    return rows;
  }
};
