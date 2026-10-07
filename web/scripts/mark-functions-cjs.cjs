// The web package is "type": "module", but tsconfig.functions.json compiles functions to CommonJS.
// Netlify's function bundler now refuses a CommonJS file whose nearest package.json says "module"
// (build failure 2026-10-06: "functions-dist/document.js is a CommonJS module, but the closest
// package.json ..."). Scope CommonJS to the compiled output only.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'netlify', 'functions-dist', 'package.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
console.log('  marked netlify/functions-dist as CommonJS');
