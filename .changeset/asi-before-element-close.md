---
'@tsrx/core': patch
---

Allow omitting the trailing semicolon before an element closing tag. Previously, a JS statement inside an element body without a trailing `;` or newline before `</tag>` (e.g. `<ul>var a = "123"</ul>`) crashed the parser with "Unterminated regular expression" because the tokenizer misread `</` as less-than followed by a regex literal. The parser now treats a `</ident>` lookahead — which is never a valid JS continuation — as a statement terminator inside element children.
