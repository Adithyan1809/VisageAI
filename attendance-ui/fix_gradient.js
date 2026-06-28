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
const targetString = "bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400";
const replacementString = "text-foreground";

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes(targetString)) {
    let newContent = content.split(targetString).join(replacementString);
    fs.writeFileSync(file, newContent, 'utf8');
    modifiedCount++;
  }
});

console.log(`Replaced gradient in ${modifiedCount} files.`);
