const fs = require('fs');
const file = 'pages/login.jsx';
let content = fs.readFileSync(file, 'utf8');
content = content.replace(/text-muted/g, 'text-slate-400');
fs.writeFileSync(file, content);
