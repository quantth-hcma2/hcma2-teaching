# Third-party notices — pdfmake bundle

`pdfmake.min.js` is a webpack bundle of pdfmake 0.3.11 and its production dependency tree (resolved from the
registry package metadata at vendoring time). License identifiers below are taken from each package's own
`package.json`; full texts are available in the respective npm packages. The fonts are covered separately by the
OFL files in `fonts/`.

| Package | Version | License |
|---|---|---|
| pdfmake | 0.3.11 | MIT (`PDFMAKE-LICENSE.txt`) |
| pdfkit | 0.19.1 | MIT |
| fontkit | 2.0.4 | MIT |
| linebreak | 1.1.0 | MIT |
| xmldoc | 2.0.3 | MIT |
| sax | 1.6.1 | BlueOak-1.0.0 |
| restructure | 3.0.2 | MIT |
| dfa | 1.2.0 | MIT |
| brotli | 1.3.3 | MIT |
| browserify-zlib | 0.2.0 | MIT |
| pako | 0.2.9 | MIT |
| pako | 1.0.11 | MIT AND Zlib |
| base64-js | 0.0.8 / 1.5.1 | MIT |
| clone | 2.1.2 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| js-md5 | 0.8.3 | MIT |
| png-js | 1.1.0 | MIT (Copyright (c) 2017 Devon Govett) |
| tiny-inflate | 1.0.3 | MIT |
| unicode-properties | 1.4.1 | MIT |
| unicode-trie | 2.0.0 | MIT |
| @noble/ciphers | 1.3.0 | MIT |
| @noble/hashes | 1.8.0 | MIT |
| @swc/helpers | 0.5.23 | Apache-2.0 |
| tslib | 2.8.1 | 0BSD |

Also bundled by pdfmake at build time (not part of the runtime dependency list above): `file-saver` (declared by
pdfmake as `^2.0.5`, MIT; provides the browser `download()` helper) and `svg-to-pdfkit` (MIT, "Copyright (c) 2019
SVG-to-PDFKit contributors", vendored inside pdfmake's own source tree).
