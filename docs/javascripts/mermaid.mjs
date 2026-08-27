import mermaid from "https://unpkg.com/mermaid@11.16.0/dist/mermaid.esm.min.mjs";

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  themeVariables: {
    primaryColor: "#dff6fc",
    primaryTextColor: "#1a5276",
    primaryBorderColor: "#2e86c1",
    lineColor: "#2e86c1",
    secondaryColor: "#f2fbfd",
    tertiaryColor: "#ffffff",
    fontFamily: "var(--md-text-font-family)",
  },
});

async function renderMermaidDiagrams() {
  const diagrams = document.querySelectorAll(".mermaid:not([data-processed])");
  if (diagrams.length > 0) {
    await mermaid.run({ nodes: diagrams });
  }
}

if (typeof document$ !== "undefined") {
  document$.subscribe(renderMermaidDiagrams);
} else {
  window.addEventListener("DOMContentLoaded", renderMermaidDiagrams);
}
