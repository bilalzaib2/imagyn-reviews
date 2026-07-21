// Imagyn Reviews — structured-data engine, shared type.
//
// Every builder in builders/ returns one of these; index.server.ts composes them into a
// full JSON-LD document. Kept intentionally loose (a schema.org node is, structurally,
// just a tagged bag of properties) rather than modeling schema.org's type hierarchy —
// the builders are what encode correctness, not this type.

export type JsonLdNode = Record<string, unknown> & { "@type": string };
