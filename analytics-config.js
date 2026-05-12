window.TRACKITMX_ANALYTICS = {
  cloudflareToken: "",
  gaMeasurementId: ""
};

(() => {
  const config = window.TRACKITMX_ANALYTICS || {};
  const cloudflareToken = (config.cloudflareToken || "").trim();
  const gaMeasurementId = (config.gaMeasurementId || "").trim();

  if (cloudflareToken) {
    const cfScript = document.createElement("script");
    cfScript.defer = true;
    cfScript.src = "https://static.cloudflareinsights.com/beacon.min.js";
    cfScript.setAttribute("data-cf-beacon", JSON.stringify({ token: cloudflareToken }));
    document.head.appendChild(cfScript);
  }

  if (gaMeasurementId) {
    const gtagScript = document.createElement("script");
    gtagScript.async = true;
    gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaMeasurementId)}`;
    document.head.appendChild(gtagScript);

    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };

    window.gtag("js", new Date());
    window.gtag("config", gaMeasurementId);
  }
})();
