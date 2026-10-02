# Offline keyboard manual

These files contain concise manual pages for every custom-keyboard function
and keyword, plus `rank(7)`, a beginner's guide to reading them. The mobile
and web apps bundle the complete manual locally through `key-manual.ts`;
opening a page never fetches documentation from the internet.

Each entry has NAME, SYNOPSIS, DESCRIPTION and EXAMPLES. Explain inputs,
results and important limits in ordinary language. Examples include their
setup and a short explanation. Source lines, signatures and code stay within
40 columns. File, database and image examples must state any host or fixture
requirements. The interpreter's `manual.test.ts` checks coverage, formatting
and example execution; the browser regression checks the viewer and copying.

Edit the relevant module file when behavior changes. The language catalogue
remains the authority for builtin names and imports; the coverage check fails
when a new keyboard entry lacks a page.
