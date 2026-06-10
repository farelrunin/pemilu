const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

function replaceInFile(filePath, replacements) {
  if (!fs.existsSync(filePath)) return;
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  
  replacements.forEach(rep => {
    content = content.split(rep.search).join(rep.replace);
  });
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated: ${path.relative(projectRoot, filePath)}`);
  }
}

// 1. Update routes/tps.js
replaceInFile(path.join(projectRoot, 'routes', 'tps.js'), [
  {
    search: "'gondobari somokaton', 'gondobari-somokaton', 'gondobari'",
    replace: "'gondobari somokaton', 'gondobari-somokaton', 'gondobari', 'gondosari somokaton', 'gondosari-somokaton', 'gondosari'"
  },
  {
    search: "THEN 'Gondobari-Somokaton'",
    replace: "THEN 'Gondosari-Somokaton'"
  }
]);

// 2. Update server.js
replaceInFile(path.join(projectRoot, 'server.js'), [
  {
    search: "'gondobari somokaton', 'gondobari-somokaton', 'gondobari'",
    replace: "'gondobari somokaton', 'gondobari-somokaton', 'gondobari', 'gondosari somokaton', 'gondosari-somokaton', 'gondosari'"
  },
  {
    search: "THEN 'Gondobari-Somokaton'",
    replace: "THEN 'Gondosari-Somokaton'"
  },
  {
    search: "THEN 'gondobari-somokaton'",
    replace: "THEN 'gondosari-somokaton'"
  }
]);

// 3. Update public/peta-sitimulyo.html
replaceInFile(path.join(projectRoot, 'public', 'peta-sitimulyo.html'), [
  { search: "id=\"dusun-gondobari-somokaton\"", replace: "id=\"dusun-gondosari-somokaton\"" },
  { search: "id=\"label-dusun-gondobari-somokaton\"", replace: "id=\"label-dusun-gondosari-somokaton\"" },
  { search: ">Gondobari</text>", replace: ">Gondosari</text>" },
  { search: "'gondobari somokaton': 'dusun-gondobari-somokaton'", replace: "'gondosari somokaton': 'dusun-gondosari-somokaton',\n    'gondobari somokaton': 'dusun-gondosari-somokaton'" },
  { search: "'gondobari-somokaton': 'dusun-gondobari-somokaton'", replace: "'gondosari-somokaton': 'dusun-gondosari-somokaton',\n    'gondobari-somokaton': 'dusun-gondosari-somokaton'" },
  { search: "'gondobari': 'dusun-gondobari-somokaton'", replace: "'gondosari': 'dusun-gondosari-somokaton',\n    'gondobari': 'dusun-gondosari-somokaton'" },
  { search: "gondobari-somokaton", replace: "gondosari-somokaton" }
]);

// 4. Update public/peta-kader.html
replaceInFile(path.join(projectRoot, 'public', 'peta-kader.html'), [
  { search: "id=\"dusun-gondobari-somokaton\"", replace: "id=\"dusun-gondosari-somokaton\"" },
  { search: "id=\"label-dusun-gondobari-somokaton\"", replace: "id=\"label-dusun-gondosari-somokaton\"" },
  { search: ">Gondobari</text>", replace: ">Gondosari</text>" },
  { search: "'gondobari somokaton': 'dusun-gondobari-somokaton'", replace: "'gondosari somokaton': 'dusun-gondosari-somokaton',\n    'gondobari somokaton': 'dusun-gondosari-somokaton'" },
  { search: "'gondobari-somokaton': 'dusun-gondobari-somokaton'", replace: "'gondosari-somokaton': 'dusun-gondosari-somokaton',\n    'gondobari-somokaton': 'dusun-gondosari-somokaton'" },
  { search: "'gondobari': 'dusun-gondobari-somokaton'", replace: "'gondosari': 'dusun-gondosari-somokaton',\n    'gondobari': 'dusun-gondosari-somokaton'" },
  { search: "gondobari-somokaton", replace: "gondosari-somokaton" }
]);

// 5. Update public/laporan-dusun.html
replaceInFile(path.join(projectRoot, 'public', 'laporan-dusun.html'), [
  { search: "Gondobari-Somokaton", replace: "Gondosari-Somokaton" }
]);
