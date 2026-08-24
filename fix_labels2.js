 const fs = require('fs');
const p = 'backend/src/services/scoringService.ts';
let s = fs.readFileSync(p, 'utf8');
const NL = String.fromCharCode(10);
const CRNL = String.fromCharCode(13) + NL;
const EOL = s.includes(CRNL) ? CRNL : NL;
const Q = String.fromCharCode(39);

// oldBlock matches the file text EXACTLY (the file contains literal backslash-n in .join('\n\n'))
const oldBlock = [
  '  const conversationLog = messages',
  '    .map(m => `[${' + 'm.role === ' + Q + 'user' + Q + ' ? ' + Q + 'CANDIDATE' + Q + ' : ' + Q + 'INTERVIEWER' + Q + '}]: ${m.content}`)',
  "    .join('\\n\\n');"
].join(EOL);

const newBlock = [
  '  // Label roles correctly based on who the human played',
  '  const humanIsCandidate = userRole === ' + Q + 'interviewee' + Q + ';',
  '  const conversationLog = messages',
  '    .map(m => {',
  "      const isCandidate = humanIsCandidate ? m.role === 'user' : m.role === 'assistant';",
  '      return `[${isCandidate ? ' + Q + 'CANDIDATE' + Q + ' : ' + Q + 'INTERVIEWER' + Q + '}]: ${m.content}`;',
  '    })',
  "    .join('\\n\\n');"
].join(EOL);

if (s.includes(oldBlock)) {
  s = s.replace(oldBlock, newBlock);
  fs.writeFileSync(p, s);
  console.log('PATCHED: conversationLog labels roles correctly based on userRole');
} else {
  // Fallback: replace just the map line
  const oldLine = '    .map(m => `[${' + 'm.role === ' + Q + 'user' + Q + ' ? ' + Q + 'CANDIDATE' + Q + ' : ' + Q + 'INTERVIEWER' + Q + '}]: ${m.content}`)';
  const newLine = [
    '    .map(m => {',
    '      const isCandidate = (userRole === ' + Q + 'interviewee' + Q + ') ? (m.role === ' + Q + 'user' + Q + ') : (m.role === ' + Q + 'assistant' + Q + ');',
    '      return `[${isCandidate ? ' + Q + 'CANDIDATE' + Q + ' : ' + Q + 'INTERVIEWER' + Q + '}]: ${m.content}`;',
    '    })'
  ].join(EOL);
  if (s.includes(oldLine)) {
    s = s.replace(oldLine, newLine);
    fs.writeFileSync(p, s);
    console.log('PATCHED via fallback map-line replacement');
  } else {
    console.log('NOT FOUND - aborting');
  }
}