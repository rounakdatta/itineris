Caption faces, bundled so a caption looks the same on every phone and offline.
Licence texts are alongside: SIL Open Font License 1.1 for all but Permanent
Marker, which is Apache License 2.0.

| file | family | offered as | licence | copyright |
| --- | --- | --- | --- | --- |
| `grotesk-latin.woff2` | Space Grotesk 500 | Grotesk | OFL | 2020 The Space Grotesk Project Authors |
| `playfair-latin.woff2` | Playfair Display 700 | Editorial | OFL | 2017 The Playfair Display Project Authors |
| `cormorant-latin.woff2` | Cormorant Garamond 400 italic | Elegant | OFL | 2015 The Cormorant Project Authors |
| `cinzel-latin.woff2` | Cinzel 400 | Caps | OFL | 2020 The Cinzel Project Authors |
| `bebasneue-latin.woff2` | Bebas Neue 400 | Poster | OFL | 2010 Dharma Type |
| `baloo-latin.woff2` | Baloo 2 800 | Rounded | OFL | 2019 The Baloo 2 Project Authors |
| `marker-latin.woff2` | Permanent Marker 400 | Marker | Apache 2.0 | 2010 Font Diner, Inc. |
| `pacifico-latin.woff2` | Pacifico 400 | Retro | OFL | 2018 The Pacifico Project Authors |
| `shrikhand-latin.woff2` | Shrikhand 400 | Punchy | OFL | 2015 Jonny Pinhorn |
| `amatic-latin.woff2` | Amatic SC 700 | Tall | OFL | 2015 The Amatic SC Project Authors |

Latin subsets only (~250 KB in total, and no caption uses more than one). They
are bundled rather than fetched from Google so there is nothing to ask a third
party for; a caption downloads only the face it wears, and the service worker
leaves them out of the install precache (`scripts/lib/sw-assets.mjs`) and keeps
whichever ones get used.

How big and how airy each one looks at the same size setting is tuned per face
(`scale`, `leading`, `spacing` in `server/caption.js`) by rendering them all at
caption size over a photo and looking, not by guessing.
