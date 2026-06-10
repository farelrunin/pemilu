const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const files = fs.readdirSync(publicDir);

files.forEach(file => {
  if (path.extname(file) === '.html' && file !== 'peta-kader.html') {
    const filePath = path.join(publicDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Regex to match the peta-sitimulyo link in various formats
    const regex = /<a href="\/peta-sitimulyo"\s+class="([^"]*)"><span><strong>Peta Wilayah<\/strong><\/span><span class="nav-pill">PW<\/span><\/a>/g;
    
    if (regex.test(content)) {
      content = content.replace(regex, (match, classes) => {
        const isActive = classes.includes('active');
        const cleanClasses = classes.replace('active', '').trim();
        
        return `<a href="/peta-sitimulyo" class="${isActive ? 'active' : ''} ${cleanClasses}"><span><strong>Peta Pemilih</strong></span><span class="nav-pill">PP</span></a>\n        <a href="/peta-kader" class="${cleanClasses}"><span><strong>Peta Kader</strong></span><span class="nav-pill">PK</span></a>`;
      });
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated navigation in ${file}`);
    }
  }
});
