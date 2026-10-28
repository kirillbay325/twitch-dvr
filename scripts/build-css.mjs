import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const output = '/* generated from styles.css */\nwindow.__tdvrCss = ' + JSON.stringify(css) + ';\n';
fs.writeFileSync(path.join(root, 'src', 'styles-inline.js'), output);
console.log('src/styles-inline.js updated');
