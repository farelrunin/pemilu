const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'public');

const files = fs.readdirSync(dir).filter(f => f.endsWith('.html') && f !== 'login.html');

for (const f of files) {
  const p = path.join(dir, f);
  let content = fs.readFileSync(p, 'utf8');

  const startAkses = content.indexOf('<div class="sidebar-section-label">Akses Cepat</div>');
  const endAksesNav = content.indexOf('</nav>', startAkses) + 6;
  
  if (startAkses === -1) continue;

  const startModul = content.indexOf('<div class="sidebar-section-label">Modul TPS</div>');
  const endModulNav = content.indexOf('</nav>', startModul) + 6;
  
  if (startModul === -1) continue;

  // We want the order to be Modul TPS, then Akses Cepat.
  if (startModul < startAkses) {
     // Already in correct order
     continue;
  }

  // Extract blocks (including preceding whitespaces ideally, but let's just extract the blocks and replace)
  // Let's find the preceding whitespace for Akses
  let actualStartAkses = startAkses;
  while(content[actualStartAkses - 1] === ' ' || content[actualStartAkses - 1] === '\t' || content[actualStartAkses - 1] === '\n' || content[actualStartAkses - 1] === '\r') {
      actualStartAkses--;
  }

  let actualStartModul = startModul;
  while(content[actualStartModul - 1] === ' ' || content[actualStartModul - 1] === '\t' || content[actualStartModul - 1] === '\n' || content[actualStartModul - 1] === '\r') {
      actualStartModul--;
  }

  const aksesBlock = content.substring(actualStartAkses, endAksesNav);
  const modulBlock = content.substring(actualStartModul, endModulNav);

  // Remove both blocks
  content = content.replace(aksesBlock, '');
  content = content.replace(modulBlock, '');

  // Insert them before sidebar-footer
  const startFooter = content.indexOf('<div class="sidebar-footer">');
  let actualStartFooter = startFooter;
  while(content[actualStartFooter - 1] === ' ' || content[actualStartFooter - 1] === '\t' || content[actualStartFooter - 1] === '\n' || content[actualStartFooter - 1] === '\r') {
      actualStartFooter--;
  }

  const beforeFooter = content.substring(0, actualStartFooter);
  const fromFooter = content.substring(actualStartFooter);

  content = beforeFooter + modulBlock + aksesBlock + fromFooter;

  fs.writeFileSync(p, content);
  console.log('Fixed ' + f);
}
