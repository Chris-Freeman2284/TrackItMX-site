document.documentElement.classList.add("js");

const revealNodes = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.14,
      rootMargin: "0px 0px -8% 0px"
    }
  );

  revealNodes.forEach((node) => {
    revealObserver.observe(node);
  });
} else {
  revealNodes.forEach((node) => {
    node.classList.add("is-visible");
  });
}

const topbar = document.querySelector(".topbar");

const syncTopbarState = () => {
  if (!topbar) {
    return;
  }

  topbar.classList.toggle("is-scrolled", window.scrollY > 18);
};

syncTopbarState();
window.addEventListener("scroll", syncTopbarState, { passive: true });
