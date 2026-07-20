const TOTAL = 7;
let current = 0;

function activate(n: number): void {
  document.getElementById(`step-${current}`)?.classList.remove("is-active");
  document.querySelector<HTMLElement>(`.wt-dot[data-step="${current}"]`)?.classList.remove("active");

  current = Math.max(0, Math.min(TOTAL - 1, n));

  const stepEl = document.getElementById(`step-${current}`);
  stepEl?.classList.add("is-active");
  document.querySelector<HTMLElement>(`.wt-dot[data-step="${current}"]`)?.classList.add("active");

  const demo = stepEl?.querySelector<HTMLElement>(".step-demo");
  if (demo) {
    demo.classList.remove("is-playing");
    void demo.offsetHeight;
    demo.classList.add("is-playing");
  }

  const prev = document.getElementById("prev-btn") as HTMLButtonElement;
  const next = document.getElementById("next-btn") as HTMLButtonElement;
  prev.disabled = current === 0;
  next.textContent = current === TOTAL - 1 ? "Get started →" : "Next →";

  const fill = document.getElementById("progress-fill");
  if (fill) fill.style.width = `${((current + 1) / TOTAL) * 100}%`;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("prev-btn")?.addEventListener("click", () => activate(current - 1));

  document.getElementById("next-btn")?.addEventListener("click", () => {
    if (current === TOTAL - 1) {
      chrome.runtime.openOptionsPage();
      window.close();
    } else {
      activate(current + 1);
    }
  });

  document.querySelectorAll<HTMLElement>(".wt-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      activate(parseInt(dot.dataset.step ?? "0", 10));
    });
  });

  document.querySelectorAll<HTMLElement>(".replay-btn").forEach((btn) => {
    btn.addEventListener("click", () => activate(current));
  });

  document.getElementById("skip-btn")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  activate(0);
});
