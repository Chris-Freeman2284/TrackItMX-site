document.documentElement.classList.add("js");

const publicConfig = window.TRACKITMX_PUBLIC ?? {};
const SITE_NAME = publicConfig.SITE_NAME ?? "TrackItMX";
const SUPPORT_EMAIL = publicConfig.SUPPORT_EMAIL ?? "support@trackitmx.com";
const APP_STORE_URL = String(publicConfig.APP_STORE_URL ?? "").trim();

const buildMailto = (email, subject) => {
  const trimmedSubject = subject?.trim();

  if (!trimmedSubject) {
    return `mailto:${email}`;
  }

  return `mailto:${email}?subject=${encodeURIComponent(trimmedSubject)}`;
};

const syncPublicConstants = () => {
  document.querySelectorAll("[data-site-name]").forEach((node) => {
    node.textContent = SITE_NAME;
  });

  document.querySelectorAll("[data-support-email]").forEach((node) => {
    node.textContent = SUPPORT_EMAIL;
  });

  document.querySelectorAll("[data-support-link]").forEach((node) => {
    if (!(node instanceof HTMLAnchorElement)) {
      return;
    }

    node.href = buildMailto(SUPPORT_EMAIL, node.dataset.mailSubject ?? "");
  });

  document.querySelectorAll("[data-app-store-link]").forEach((node) => {
    if (!(node instanceof HTMLAnchorElement)) {
      return;
    }

    if (!APP_STORE_URL) {
      return;
    }

    node.href = APP_STORE_URL;
    node.target = "_blank";
    node.rel = "noreferrer";
  });
};

syncPublicConstants();

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
