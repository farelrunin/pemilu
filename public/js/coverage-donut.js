// coverage-donut.js
// Mengganti renderQualityDonut dengan visualisasi Coverage Pemilih vs Total DPT TPS

function renderQualityDonut(statRes, tpsData) {
  const svg    = document.getElementById('quality-donut');
  const legend = document.getElementById('quality-legend');
  if (!svg || !legend) return;

  // ── Data pemilih dari /api/pemilih/statistik ──────────────
  const totalPemilih = Number(statRes.totalSemua ?? 0);
  const clear        = Number(statRes.clear ?? statRes.total ?? 0);
  const underage     = Number(statRes.underage ?? 0);
  const butuhCek     = Math.max(0, Number(statRes.bermasalah ?? 0) - underage);
  const perluVerif   = butuhCek + underage;

  // ── Patokan 100% = total DPT dari /api/tps/statistik ─────
  const totalDPT    = tpsData ? Number(tpsData.ringkasan?.total_pemilih_tps ?? 0) : 0;
  const base        = Math.max(totalDPT, totalPemilih, 1);
  const belumTerdata = Math.max(0, totalDPT - totalPemilih);

  // ── Persentase ────────────────────────────────────────────
  const pctCoverage = totalDPT > 0 ? Math.min(100, Math.round((totalPemilih / totalDPT) * 100)) : 0;
  const pctClear    = totalDPT > 0 ? Math.round((clear    / totalDPT) * 100) : 0;
  const pctVerif    = totalDPT > 0 ? Math.round((perluVerif / totalDPT) * 100) : 0;
  const pctBelum    = Math.max(0, 100 - pctCoverage);

  // ── Warna persen berdasarkan nilai ───────────────────────
  const pctColor = pctCoverage >= 80
    ? 'var(--success)'
    : pctCoverage >= 50
      ? 'var(--warning)'
      : 'var(--danger)';

  // ── SVG Donut ─────────────────────────────────────────────
  const radius        = 72;
  const circumference = 2 * Math.PI * radius;

  const segments = [
    { value: clear,       color: 'var(--accent)'            }, // Terdata clear
    { value: perluVerif,  color: 'var(--warning)'           }, // Butuh verifikasi
    { value: belumTerdata,color: 'rgba(148,163,184,0.22)'   }, // Belum terdata
  ];

  let offset = 0;
  const arcs = segments.map(function(seg) {
    var dash = (seg.value / base) * circumference;
    var arc = '<circle cx="110" cy="110" r="' + radius + '" fill="none"'
      + ' stroke="' + seg.color + '" stroke-width="20" stroke-linecap="butt"'
      + ' stroke-dasharray="' + dash + ' ' + (circumference - dash) + '"'
      + ' stroke-dashoffset="' + (-offset) + '"'
      + ' transform="rotate(-90 110 110)"/>';
    offset += dash;
    return arc;
  }).join('');

  svg.innerHTML = ''
    + '<circle cx="110" cy="110" r="' + radius + '" fill="none" stroke="rgba(71,97,124,0.08)" stroke-width="20"></circle>'
    + arcs
    + '<circle cx="110" cy="110" r="50" fill="rgba(244,248,251,0.95)"></circle>'
    + '<text x="110" y="98" text-anchor="middle" fill="var(--text3)" font-size="11">Coverage</text>'
    + '<text x="110" y="122" text-anchor="middle" fill="' + pctColor + '" font-size="30" font-weight="800">' + pctCoverage + '%</text>'
    + '<text x="110" y="140" text-anchor="middle" fill="var(--text3)" font-size="10">dari ' + formatNum(totalDPT) + ' DPT</text>';

  // ── Legend ─────────────────────────────────────────────────
  var items = [
    { label: 'Terdata & Clear',   value: clear,       pct: pctClear,    cls: 'donut-swatch-accent'  },
    { label: 'Butuh Verifikasi',  value: perluVerif,  pct: pctVerif,    cls: 'donut-swatch-warning' },
    { label: 'Belum Terdata',     value: belumTerdata,pct: pctBelum,    cls: 'donut-swatch-empty'   },
    { label: 'Total DPT TPS',     value: totalDPT,    pct: 100,         cls: 'donut-swatch-muted'   },
  ];

  legend.innerHTML = items.map(function(item) {
    return '<div class="donut-legend-item">'
      + '<span class="donut-swatch ' + item.cls + '"></span>'
      + '<div style="min-width:0;">'
      + '<div style="display:flex;align-items:baseline;gap:6px;">'
      + '<strong style="font-size:14px;color:var(--text);font-weight:700;">' + formatNum(item.value) + '</strong>'
      + '<span style="font-size:11px;color:var(--text3);">' + item.label + '</span>'
      + '</div>'
      + '<em style="font-size:10px;color:var(--text3);font-style:normal;">' + item.pct + '% dari total DPT</em>'
      + '</div>'
      + '</div>';
  }).join('');
}