const fs = require('fs');
const path = require('path');

const API_BASE = process.env.API_BASE || '';
const FRONTEND_PASSWORD = process.env.FRONTEND_PASSWORD || '';
const DIST_DIR = path.join(__dirname, 'dist');
const CSS_DIR = path.join(DIST_DIR, 'css');
const JS_DIR = path.join(DIST_DIR, 'js');

// Ensure dist directories exist
[DIST_DIR, CSS_DIR, JS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Copy CSS
fs.copyFileSync(
    path.join(__dirname, 'css', 'style.css'),
    path.join(DIST_DIR, 'css', 'style.css')
);

// Copy JS with secrets injection
let jsContent = fs.readFileSync(path.join(__dirname, 'js', 'app.js'), 'utf8');

// Inject API_BASE (default to current origin if not set)
jsContent = jsContent.replace(
    "window.API_BASE || ''",
    API_BASE ? `'${API_BASE}'` : "window.API_BASE || ''"
);

// Inject password from secret (fallback to placeholder if not set)
const passwordPlaceholder = 'PLACEHOLDER_PASSWORD';
const passwordToUse = FRONTEND_PASSWORD || passwordPlaceholder;
jsContent = jsContent.replace(
    `'${passwordPlaceholder}'`,
    `'${passwordToUse}'`
);

fs.writeFileSync(path.join(DIST_DIR, 'js', 'app.js'), jsContent);

// Copy HTML
const htmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
fs.writeFileSync(path.join(DIST_DIR, 'index.html'), htmlContent);

console.log('Build complete!');
console.log(`API_BASE: ${API_BASE || '(uses current domain)'}`);
console.log(`PASSWORD: ${FRONTEND_PASSWORD ? '(from secret)' : '(using default)'}`);
console.log('Output: dist/');
