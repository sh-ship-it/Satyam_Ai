const fs = require('fs');
const path = require('path');

const srcDir = 'd:/college/Projects/Satyam/frontend/src';
const strings = new Set();

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file === 'node_modules' || file === '.git' || file === 'dist') continue;
      walk(fullPath);
    } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      const content = fs.readFileSync(fullPath, 'utf8');
      
      // Look for \bt("...") or \bt('...') or \bt(`...`) to avoid matching import(...)
      const matches1 = content.matchAll(/\bt\(\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\)/g);
      for (const m of matches1) {
        strings.add(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
      }
      
      const matches2 = content.matchAll(/\bt\(\s*'([^'\\]*(?:\\.[^'\\]*)*)'\s*\)/g);
      for (const m of matches2) {
        strings.add(m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
      }
      
      const matches3 = content.matchAll(/\bt\(\s*`([^`\\]*(?:\\.[^`\\]*)*)`\s*\)/g);
      for (const m of matches3) {
        if (!m[1].includes('${')) {
          strings.add(m[1].replace(/\\`/g, '`').replace(/\\\\/g, '\\'));
        }
      }
    }
  }
}

walk(srcDir);
const sorted = Array.from(strings).sort();
fs.writeFileSync('d:/college/Projects/Satyam/scratch/extracted_strings.json', JSON.stringify(sorted, null, 2));
console.log("Total unique strings found after fixing regex:", sorted.length);
