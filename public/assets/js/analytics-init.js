(function (w, d, s, l, i) {
  w[l] = w[l] || [];
  w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  var f = d.getElementsByTagName(s)[0];
  var j = d.createElement(s);
  var dl = l !== 'dataLayer' ? '&l=' + l : '';
  j.async = true;
  j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i + dl;
  if (f && f.parentNode) {
    f.parentNode.insertBefore(j, f);
  } else {
    d.head.appendChild(j);
  }
})(window, document, 'script', 'dataLayer', 'GTM-KH6J5S25');

window.dataLayer = window.dataLayer || [];
function gtag() {
  window.dataLayer.push(arguments);
}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', 'GTM-KH6J5S25');
gtag('config', 'G-LLXC1GEL75');
