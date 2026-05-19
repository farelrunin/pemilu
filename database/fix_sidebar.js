const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'public');

fs.readdirSync(dir).filter(f => f.endsWith('.html')).forEach(f => {
  if (f === 'index.html' || f === 'login.html') return;
  const p = path.join(dir, f);
  let content = fs.readFileSync(p, 'utf8');

  // Cari blok Akses Cepat
  const regexAkses = /(\s*<div class="sidebar-section-label">Akses Cepat<\/div>\s*<nav class="nav">[\s\S]*?<\/nav>\s*)/;
  
  // Cari blok Modul TPS
  const regexModul = /(\s*<div class="sidebar-section-label">Modul TPS<\/div>\s*<nav class="nav">[\s\S]*?<\/nav>\s*)/;

  const matchAkses = content.match(regexAkses);
  const matchModul = content.match(regexModul);

  if (matchAkses && matchModul) {
    const aksesStr = matchAkses[1];
    const modulStr = matchModul[1];

    // Hapus keduanya dulu
    content = content.replace(aksesStr, '');
    content = content.replace(modulStr, '');

    // Cari letak sidebar-footer
    const footerRegex = /(\s*<div class="sidebar-footer">)/;
    
    // Sisipkan Modul TPS lalu Akses Cepat tepat sebelum footer
    content = content.replace(footerRegex, modulStr + aksesStr + '$1');

    fs.writeFileSync(p, content);
    console.log('Fixed ' + f);
  }
});
