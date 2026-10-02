# Vendored PDF libraries and fonts — provenance (Group PDF V1)

These files are shipped as-is, byte for byte, and are loaded **lazily** by `group-pdf-runtime.mjs` only when a
teacher presses `TẢI PDF`. They are never loaded at page start. `SHA256SUMS.txt` records the SHA-256 of every file
here; `test/group-pdf-v1/vendor-integrity.test.mjs` re-hashes them. Update both together, never one without the other.
`.gitattributes` in this folder (`* -text`) prevents any line-ending conversion.

## pdfmake 0.3.11

| | |
|---|---|
| File | `pdfmake.min.js` (UMD browser bundle, global `pdfMake`) |
| Source | npm `pdfmake@0.3.11`, file `build/pdfmake.min.js` (copied unmodified) |
| npm tarball | `https://registry.npmjs.org/pdfmake/-/pdfmake-0.3.11.tgz` |
| npm integrity | `sha512-Uc49J9hUMyuqJk+U+PxlpBpPr96A4HOOfesGx609EPr2ue82+5/Smq/KTAkEqh0/jUGSi1fumvqZ5yAWijJTJg==` |
| License | MIT — `PDFMAKE-LICENSE.txt` |
| SHA-256 | `FAAEE53F8DCF48B0934553665809D8180E20E435B654F633DF2F18F9DBDEAA88` |
| Size | 1,053,972 bytes raw, 350,763 bytes gzip -9 |

The bundle embeds its production dependencies; see `THIRD-PARTY-NOTICES.md`.

## Roboto 3.015 (Regular, Bold, Italic, BoldItalic)

| | |
|---|---|
| Files | `fonts/Roboto-Regular.ttf`, `Roboto-Bold.ttf`, `Roboto-Italic.ttf`, `Roboto-BoldItalic.ttf` |
| Source | npm `@expo-google-fonts/roboto@0.4.3`, `Roboto_400Regular.ttf`, `Roboto_700Bold.ttf`, `Roboto_400Regular_Italic.ttf`, `Roboto_700Bold_Italic.ttf` (copied unmodified, renamed) |
| npm integrity | `sha512-kX3wmpmu06fN1yOwYWMdjYJWNUYW6xUiAGeHbvPzzSEb3A3j23JelQ3tAgwQNKgEKRq6wtMmzixy2r7y9c8dsA==` |
| Font version | `Version 3.015; 2026` |
| License | SIL Open Font License 1.1 — `fonts/Roboto-OFL.txt` ("Copyright 2011 The Roboto Project Authors", https://github.com/googlefonts/roboto-classic) |
| Why not pdfmake's bundled Roboto | its "bold" face is Roboto **Medium**, not true Bold |
| Size | 650,532 bytes raw for the four faces (~392 KB gzip) |

| File | SHA-256 |
|---|---|
| `Roboto-Regular.ttf` | `15256405ECB0D880678833A582760EFAD538AB2932318B52C8105B267D159459` |
| `Roboto-Bold.ttf` | `4AAF8C5B661A386998C2E70CF2B87E2440F5404E0B8FD81164F0413FB3435EC6` |
| `Roboto-Italic.ttf` | `6A372C348DC20C246B92D60B9BDA3C0A9FFEDC129790ED3F31FAF89DAA99D793` |
| `Roboto-BoldItalic.ttf` | `C6A5E7C224D3BF6698E5D3C124F0F0220CAD20D5D413920447A96F033A0292EE` |

## Tinos 1.340 (Regular, Bold, Italic, BoldItalic) — loaded only when content uses a `times` run

| | |
|---|---|
| Files | `fonts/Tinos-Regular.ttf`, `Tinos-Bold.ttf`, `Tinos-Italic.ttf`, `Tinos-BoldItalic.ttf` |
| Source | npm `@expo-google-fonts/tinos@0.4.2`, `Tinos_400Regular.ttf`, `Tinos_700Bold.ttf`, `Tinos_400Regular_Italic.ttf`, `Tinos_700Bold_Italic.ttf` (copied unmodified, renamed) |
| npm integrity | `sha512-MQkfvUO1Aw7UP3jRtWLcjda+udanoL8ecrbkjbc3ZdhSI1iW/Uil4uD8O0eOiIxU2v/FeAT2XjGNiz5oYUlucg==` |
| Font version | `Version 1.340; ttfautohint (v1.8.4.16-eb64)` |
| License | SIL Open Font License 1.1 — `fonts/Tinos-OFL.txt` ("Copyright 2026 The Tinos Project Authors", https://github.com/googlefonts/tinos) |
| Size | 2,205,748 bytes raw for the four faces (~1.17 MB gzip) |

| File | SHA-256 |
|---|---|
| `Tinos-Regular.ttf` | `924EF269E73DA94C1803FF68877F5D998DD16605C5FFAD82EE181034F8A1FFFE` |
| `Tinos-Bold.ttf` | `576A19B5DC026CAFE6AE8FDE4C849588DAE6475CF5D912CEBDF2827388C43AD9` |
| `Tinos-Italic.ttf` | `4A52DE5BCF70E37BD71949F8A85302B75795A1943AEDFFBBEE4F2DB7744E1C81` |
| `Tinos-BoldItalic.ttf` | `10C90EF7896D758923C06A1485D7824CDB457466DA0BF7D42F81C5228931281B` |

## Font coverage table

`../../group-pdf-font-coverage.mjs` is generated from the cmap tables of the eight TTFs above (code points present in
**every** face of a family) by `../../tools/gen-pdf-font-coverage.mjs` (needs `fontkit` 2.0.4, which is a dependency of
pdfmake; it is a build-time tool only and is not shipped). Measured: Roboto 928 code points, Tinos 3,012. All 209
Vietnamese test characters (every vowel × 6 tones, upper and lower case, đ/Đ) are covered by both families.
`U+FFFD` is present in all eight faces and is the explicit replacement glyph.

## Font mapping used by Group PDF V1

`default`, `arial`, `roboto` → Roboto. `times` → Tinos. Arial is therefore substituted by Roboto.
