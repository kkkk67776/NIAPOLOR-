(function () {
  try {
    var saved = localStorage.getItem('echox_theme');
    var metaTheme = document.querySelector('meta[name="theme-color"]');
    if (saved !== 'light') {
      document.documentElement.classList.add('dark');
      if (metaTheme) metaTheme.setAttribute('content', '#0B0B0D');
    } else {
      document.documentElement.classList.remove('dark');
      if (metaTheme) metaTheme.setAttribute('content', '#FAF9F7');
    }
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
