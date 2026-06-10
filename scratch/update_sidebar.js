const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const files = fs.readdirSync(publicDir);

files.forEach(file => {
  if (file.endsWith('.html')) {
    const filePath = path.join(publicDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Pattern to look for the sidebar labels
    const pattern = /<div class="sidebar-section-label([^"]*)">([^<]+)<\/div>/g;
    
    if (pattern.test(content)) {
      console.log(`Processing file: ${file}`);
      const updatedContent = content.replace(pattern, (match, classes, labelText) => {
        const cleanLabel = labelText.trim();
        const slug = cleanLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        console.log(`  Replacing "${cleanLabel}" (extra classes: "${classes.trim()}") -> slug: "${slug}"`);
        return `<div class="sidebar-section-header${classes}" data-section="${slug}">
        <span class="sidebar-section-label">${cleanLabel}</span>
        <span class="sidebar-section-arrow">▼</span>
      </div>`;
      });
      
      fs.writeFileSync(filePath, updatedContent, 'utf8');
      console.log(`  Successfully updated ${file}`);
    } else {
      console.log(`Skipped: ${file} (no sidebar section label found)`);
    }
  }
});
console.log('Sidebar migration completed!');
