import { getTreeSitterClient } from "@opentui/core";
import hljs from "highlight.js";

const client = getTreeSitterClient();
const samples = [
  ["typescript", "const value: number = 42;\n"],
  ["typescriptreact", "export function App() { return <div />; }\n"],
  ["javascript", "const value = { ok: true };\n"],
  ["javascriptreact", "export function App() { return <div />; }\n"],
  ["markdown", "# Heading\n\n`code`\n"],
  ["zig", "const std = @import(\"std\");\n"],
] as const;

let failed = false;

for (const [filetype, content] of samples) {
  const result = await client.highlightOnce(content, filetype);
  const count = result.highlights?.length ?? 0;
  if (result.error || result.warning || count === 0) {
    failed = true;
    console.error(`${filetype}: ${result.error ?? result.warning ?? "no highlights"}`);
  } else {
    console.log(`${filetype}: ${count} highlights`);
  }
}

const fallbackSamples = [
  ["python", "def greet(name):\n    return f\"hello {name}\"\n"],
  ["rust", "fn main() {\n    println!(\"hello\");\n}\n"],
  ["bash", "set -euo pipefail\nbun run test:highlight\n"],
  ["json", "{\n  \"ok\": true,\n  \"count\": 2\n}\n"],
  ["css", ".panel { color: red; }\n"],
  ["xml", "<section class=\"panel\">hello</section>\n"],
] as const;

for (const [language, content] of fallbackSamples) {
  if (!hljs.getLanguage(language)) {
    failed = true;
    console.error(`${language}: highlight.js language not registered`);
    continue;
  }
  const result = hljs.highlight(content, { language, ignoreIllegals: true });
  if (!result.value || result.value === content) {
    failed = true;
    console.error(`${language}: no fallback highlighting output`);
  } else {
    console.log(`${language}: fallback highlights`);
  }
}

await client.destroy();

if (failed) {
  process.exit(1);
}
