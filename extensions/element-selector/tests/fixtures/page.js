// What the page itself hears. The selector must keep picking clicks away from it.
window.heard = { click: 0, mousedown: 0, pointerdown: 0, keydown: 0 };
for (const type of Object.keys(window.heard)) {
  document.addEventListener(type, () => { window.heard[type] += 1; });
}

// A component with a closed shadow root: from outside it is one opaque element.
customElements.define("fancy-widget", class extends HTMLElement {
  constructor() {
    super();
    const root = this.attachShadow({ mode: "closed" });
    root.innerHTML = '<div class="widget"><button class="widget-action" type="button">Inside the shadow</button></div>';
  }
});

// A page that tries to embed the selector's panel on its own (see the click-jacking check).
const rogue = new URLSearchParams(location.search).get("rogue");
if (rogue) {
  const frame = document.createElement("iframe");
  frame.id = "rogue";
  frame.src = `chrome-extension://${rogue}/panel.html`;
  frame.style.cssText = "width: 400px; height: 200px;";
  document.body.append(frame);
}
