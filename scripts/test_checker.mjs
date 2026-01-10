import { FileUnderstander } from '../src/indexer/understander/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // Force regex backend to rule out Verible issues
  const understander = new FileUnderstander({ backend: 'regex' });
  const filePath = path.join(__dirname, '../src/__tests__/fixtures/sv/checker_example.sv');

  console.log('Testing file:', filePath);
  console.log('Backend: regex (forced)');
  const result = await understander.understand(filePath);
  console.log('Declarations found:', result.declarations.length);
  result.declarations.forEach(d => {
    console.log('  -', d.kind + ':', d.name);
  });
  console.log('Checker count:', result.declarations.filter(d => d.kind === 'checker').length);
}

main().catch(console.error);
