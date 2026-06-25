const fs = require('fs');
const path = require('path');

const i18nPath = 'd:/college/Projects/Satyam/frontend/src/lib/i18n.tsx';
const jsonPath = 'd:/college/Projects/Satyam/scratch/extracted_strings.json';

let content = fs.readFileSync(i18nPath, 'utf8');
const strings = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

// Format the strings as a nice JS array
const formattedArray = strings.map(s => JSON.stringify(s)).join(',\n  ');
const newBlock = `const ALL_TRANSLATABLE: string[] = [\n  ${formattedArray}\n];`;

const regex = /const ALL_TRANSLATABLE:\s*string\[\]\s*=\s*\[[\s\S]*?\];/;
if (!regex.test(content)) {
  console.error("Could not find ALL_TRANSLATABLE block in i18n.tsx");
  process.exit(1);
}

const updatedContent = content.replace(regex, newBlock);
fs.writeFileSync(i18nPath, updatedContent, 'utf8');
console.log("Successfully updated ALL_TRANSLATABLE in i18n.tsx!");
