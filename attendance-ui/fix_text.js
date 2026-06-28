const fs = require('fs');
const path = require('path');

const dirs = [
  path.join(__dirname, 'pages'),
  path.join(__dirname, 'components')
];

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(file));
    } else if (file.endsWith('.jsx') || file.endsWith('.js')) {
      results.push(file);
    }
  });
  return results;
}

let files = [];
dirs.forEach(d => {
  if (fs.existsSync(d)) {
    files = files.concat(walk(d));
  }
});

let modifiedCount = 0;

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  
  // We want to replace 'text-white' with 'text-foreground'
  // BUT we don't want to replace it if it's part of a button or badge that is inherently dark,
  // like bg-brand-blue, bg-red-600, bg-blue-500, bg-success, bg-danger.
  
  // A simple regex: replace 'text-white' with 'text-foreground' UNLESS it's on the same line as a solid color bg.
  // Actually, since tailwind classes are space separated, it's safer to just replace all 'text-white' EXCEPT those matching specific combinations.
  
  let newContent = content.split('\n').map(line => {
    if (line.includes('text-white')) {
      // If line has solid background colors, skip replacing text-white
      if (/(bg-brand-blue|bg-blue-|bg-red-|bg-green-|bg-success|bg-danger)/.test(line)) {
        return line;
      }
      return line.replace(/text-white/g, 'text-foreground');
    }
    return line;
  }).join('\n');

  if (content !== newContent) {
    fs.writeFileSync(file, newContent, 'utf8');
    modifiedCount++;
  }
});

console.log(`Replaced text-white in ${modifiedCount} files.`);
