Caption faces, all under the SIL Open Font License 1.1 (licence texts alongside):

| file | family | used by | copyright |
| --- | --- | --- | --- |
| `playfair-latin.woff2` | Playfair Display 700 | Editorial | 2017 The Playfair Display Project Authors |
| `cormorant-latin.woff2` | Cormorant Garamond 400 italic | Elegant | 2015 The Cormorant Project Authors |
| `cinzel-latin.woff2` | Cinzel 400 | Caps | 2020 The Cinzel Project Authors |
| `grotesk-latin.woff2` | Space Grotesk 500 | Grotesk | 2020 The Space Grotesk Project Authors |
| `bebasneue-latin.woff2` | Bebas Neue 400 | Poster | 2010 Dharma Type |

Latin subsets only (~88 KB in total). They are bundled rather than fetched from
Google so captions look the same offline, on every device, with nothing to ask
a third party for. A caption uses one face, so the browser downloads only that
file; the service worker leaves them out of the install precache
(`scripts/lib/sw-assets.mjs`) and keeps whichever ones get used.
