/** Exact deny-only classifications. No entry authorizes a resource fetch.
 * Provenance: docs/partay-declared-resources.json. One denial per entry/run. */
export const DECLARED_BLOCKED_RESOURCES = Object.freeze(
  [
    {
      category: "avatar-vrm",
      resourceType: "script",
      url: "https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.4.0/lib/three-vrm.module.min.js",
    },
    {
      category: "three-core",
      resourceType: "script",
      url: "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    },
    {
      category: "three-loader",
      resourceType: "script",
      url: "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/loaders/GLTFLoader.js",
    },
    {
      category: "font-stylesheet-1",
      resourceType: "stylesheet",
      url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Outfit:wght@400;500;600;700;800;900&display=swap",
    },
    {
      category: "font-stylesheet-2",
      resourceType: "stylesheet",
      url: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;800&family=Fraunces:opsz,wght@9..144,500;9..144,800&family=DM+Serif+Display&family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@500;700&family=Bebas+Neue&family=Syne:wght@600;800&family=Sora:wght@600;800&family=Caveat:wght@600;700&family=Archivo+Black&family=Spectral:wght@600;800&family=Unbounded:wght@600;800&display=swap",
    },
  ].map((resource) => Object.freeze(resource)),
);
